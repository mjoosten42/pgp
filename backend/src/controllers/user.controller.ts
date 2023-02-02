import { Controller, Get, Inject, Param, HttpException, HttpStatus, Body, UseInterceptors, UploadedFile, ParseFilePipeBuilder, UseGuards, ClassSerializerInterceptor, Injectable, ExecutionContext, CanActivate, Res, Delete, Post, ParseIntPipe, PipeTransform, ArgumentMetadata, Put, HttpCode, SetMetadata } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Express, Response} from "express";
import { User } from "../entities/User";
import { Invite } from "../entities/Invite";
import { FriendRequest } from "../entities/FriendRequest";
import { Repository } from "typeorm";
import { IsString, Length } from "class-validator";
import { HttpAuthGuard } from "../auth/auth.guard";
import { Me, ParseIDPipe, ParseUsernamePipe } from "../util";
import { randomBytes } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { finished, Readable } from "node:stream";
import { join } from "path";
import { AVATAR_DIR, DEFAULT_AVATAR } from "../vars";
import * as sharp from "sharp";
import { SetupGuard } from "src/guards/setup.guard";

declare module "express" {
	export interface Request {
		user?: User;
	}
}

class UsernameDTO {
	@IsString()
	@Length(3, 20)
	username: string;
}

export function GenericUserController(route: string, options: { param: string, cparam: string, pipe: any }) {
	@Controller(route)
	@UseGuards(HttpAuthGuard)
	@UseInterceptors(ClassSerializerInterceptor)
	class UserControllerFactory {
		constructor(
			@Inject("USER_REPO")
			readonly user_repo: Repository<User>,
			@Inject("FRIENDREQUEST_REPO")
			readonly request_repo: Repository<FriendRequest>,
			@Inject("INVITE_REPO")
			readonly invite_repo: Repository<Invite>,
		) {}

		@Get()
		@UseGuards(SetupGuard)
		async list_all() {
			return this.user_repo.find();
		}

		@Get(options.cparam)
		@UseGuards(SetupGuard)
		async get_user(
			@Me() me: User,
			@Param(options.param, options.pipe) user?: User) {
			user = user || me;
			return this.user_repo.findOneBy({ id: user.id });
		}

		@Put(options.cparam + "/username")
		async set_username(
			@Me() me: User,
			@Param(options.param, options.pipe) user: User,
			@Body() dto: UsernameDTO,
		) {
			user = user || me;
			if (user.id !== me.id)
				throw new HttpException("forbidden", HttpStatus.FORBIDDEN);

			if (await this.user_repo.findOneBy({ username: dto.username }))
				throw new HttpException("username taken", HttpStatus.FORBIDDEN);
			user.username = dto.username;
			return this.user_repo.save(user);
		}

		@Get(options.cparam + "/avatar")
		@UseGuards(SetupGuard)
		async get_avatar(
			@Me() me: User,
			@Param(options.param, options.pipe) user: User,
			@Res() response: Response,
		) {
			user = user || me;
			response.redirect(user.avatar);
		}

		@Put(options.cparam + "/avatar")
		@UseInterceptors(FileInterceptor("avatar"))
		@UseGuards(SetupGuard)
		async set_avatar(
			@Me() me: User,
			@Param(options.param, options.pipe) user: User,
			@UploadedFile(
				new ParseFilePipeBuilder().addMaxSizeValidator({
					maxSize: 10485760
				}).build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }))
			uploaded_file: Express.Multer.File,
		) {
			user = user || me;
			if (user.id !== me.id)
				throw new HttpException("forbidden", HttpStatus.FORBIDDEN);

			let new_base;
			do {
				new_base = user.id + randomBytes(20).toString("hex");
			} while (new_base === user.avatar_base);

			const transform = sharp().resize(200, 200).jpeg();
			//TODO catch possible exception thrown by open?
			const file = await open(join(AVATAR_DIR, new_base + ".jpg"), "w");
			const stream = file.createWriteStream();

			const istream = new Readable();
			istream.push(uploaded_file.buffer);
			istream.push(null);
			istream.pipe(transform).pipe(stream);

			const promise = new Promise((resolve, reject) => {
				finished(transform, async (error: Error) => {
					if (error) {
						reject({statusCode: HttpStatus.UNPROCESSABLE_ENTITY, statusMessage: "bad image"});
					} else {
						try {
							if (user.avatar_base !== DEFAULT_AVATAR)
								await rm(user.avatar_path);
							user.avatar_base = new_base;
						} catch (ex) {
							console.error(ex);
							reject({statusCode: HttpStatus.INTERNAL_SERVER_ERROR, statusMessage: "could not set image"});
						}
					}
					//TODO check if the files get properly closed on an exception
					stream.close();
					file.close();
					await this.user_repo.save(user);
					resolve(user);
				});
			});
			try {
				return await promise;
			} catch (error) {
				throw new HttpException(error.statusMessage, error.statusCode);
			}
		}

		@Get(options.cparam + "/auth_req")
		@UseGuards(SetupGuard)
		async get_auth_req(
			@Me() me: User,
			@Param(options.param, options.pipe) user: User
		) {
			user = user || me;
			if (user.id !== me.id)
				throw new HttpException("forbidden", HttpStatus.FORBIDDEN);
			return { auth_req: user.auth_req };
		}

		@Get(options.cparam + "/friend(s)?")
		@UseGuards(SetupGuard)
		async list_friends(
			@Me() me: User,
			@Param(options.param, options.pipe) user: User
		) {
			user = user || me;
			if (user.id !== me.id)
				throw new HttpException("forbidden", HttpStatus.FORBIDDEN);
			return this.user_repo.findBy({ friends: { id: user.id } });
		}

		@Delete(options.cparam + "/friend(s)?/:friend_id")
		@UseGuards(SetupGuard)
		@HttpCode(HttpStatus.NO_CONTENT)
		async unfriend(
			@Me() me: User,
			@Param(options.param, options.pipe) user: User,
			@Param("friend_id", ParseIDPipe(User)) friend: User,
		) {
			user = user || me;
			if (user.id !== me.id)
				throw new HttpException("forbidden", HttpStatus.FORBIDDEN);

			const user_friends = await user.friends;
			const friend_idx = user_friends?.findIndex((x: User) => x.id === friend.id);
			if (!friend_idx || friend_idx < 0)
				throw new HttpException("not found", HttpStatus.NOT_FOUND);

			const friend_friends = await friend.friends;
			const user_idx = friend_friends.findIndex((x: User) => x.id === user.id);

			user_friends.splice(friend_idx, 1);
			friend_friends.splice(user_idx, 1);
			await this.user_repo.save([user, friend]);
		}

		@Get(options.cparam + "/friend(s)?/request(s)?")
		@UseGuards(SetupGuard)
		async list_requests(
			@Me() me: User,
			@Param(options.param, options.pipe) user: User
		) {
			user = user || me;
			if (user.id !== me.id)
				throw new HttpException("forbidden", HttpStatus.FORBIDDEN);
			return this.request_repo.find({
				relations: {
					from: true,
					to: true,
				},
				where: [
					{ from: { id: user.id } },
					{ to: { id: user.id } },
				],
			});
		}

		@Post(options.cparam + "/friend(s)?/request(s)?")
		@UseGuards(SetupGuard)
		async create_request(
			@Me() me: User,
			@Param(options.param, options.pipe) user: User,
			@Body("id", ParseIDPipe(User)) target: User,
		) {
			user = user || me;
			if (user.id !== me.id)
				throw new HttpException("forbidden", HttpStatus.FORBIDDEN);

			if (user.id === target.id)
				throw new HttpException("cannot befriend yourself", HttpStatus.UNPROCESSABLE_ENTITY);

			const user_friends = await user.friends;
			if (user_friends?.find(friend => friend.id === target.id))
				throw new HttpException("already friends", HttpStatus.FORBIDDEN);

			if (await this.request_repo.findOneBy({ from: { id: user.id }, to: { id: target.id } }))
				throw new HttpException("already sent request", HttpStatus.FORBIDDEN);

			const request = await this.request_repo.findOneBy({ from: { id: target.id }, to: { id: user.id } });
			if (request) {
				user.add_friend(target);
				target.add_friend(user);

				await this.request_repo.remove(request);
				await this.user_repo.save([user, target]);
			} else {
				const friend_request = new FriendRequest();
				friend_request.from = user;
				friend_request.to = target;
				await this.request_repo.save(friend_request);
			}
			return {};
		}

		@Delete(options.cparam + "/friend(s)?/request(s)?/:request_id")
		@UseGuards(SetupGuard)
		async delete_request(
			@Me() me: User,
			@Param(options.param, options.pipe) user: User,
			@Param("request_id", ParseIDPipe(FriendRequest)) request: FriendRequest
		) {
			user = user || me;
			if (user.id !== me.id)
				throw new HttpException("forbidden", HttpStatus.FORBIDDEN);
			if (user.id !== (await request.from).id && user.id !== (await request.to).id)
				throw new HttpException("not found", HttpStatus.NOT_FOUND);
			await this.request_repo.remove(request);
		}

		@Get(`${options.cparam}/invites`)
		async invites(@Me() user: User) {
			return this.invite_repo.find({
				relations: {
					from: true,
					to: true,
				},
				where: [
					{ from: { id: user.id } },
					{ to: { id: user.id } },
				],
			});
		}
	}
	return UserControllerFactory;
}

class NullPipe implements PipeTransform {
	async transform(value: any, metadata: ArgumentMetadata) {
		return null;
	}
}

export class UserMeController extends GenericUserController("user/", { param: "me", cparam: "me", pipe: NullPipe }) {}
export class UserIDController extends GenericUserController("user/id", { param: "id", cparam: ":id", pipe: ParseIDPipe(User) }) {}
export class UserUsernameController extends GenericUserController("user/", { param: "username", cparam: ":username", pipe: ParseUsernamePipe }) {}
