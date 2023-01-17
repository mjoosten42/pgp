import {
	Controller,
	UseGuards,
	Inject,
	Post,
	Get,
	Delete,
	Query,
	Body,
	HttpException,
	HttpStatus,
	HttpCode,
	UseInterceptors,
	ClassSerializerInterceptor,
} from '@nestjs/common';
import { Repository, Not } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../entities/User';
import { ChatRoom } from '../entities/ChatRoom';
import { RoomInvite } from '../entities/RoomInvite';
import { SetupGuard } from './account.controller';
import { GetRoomQuery, GetUser, GetUserQuery } from '../util';
import {
	IsNumberString,
	IsString,
	MinLength,
	MaxLength,
	IsOptional,
	IsEnum,
} from 'class-validator';
import * as argon2 from 'argon2';
import { PGP_DEBUG } from '../vars';
import { Access } from '../Access';

class RoomDTO {
	@IsNumberString()
	id: string;
}

class JoinRoomDTO {
	@IsNumberString()
	id: string;

	@MinLength(3)
	@MaxLength(20)
	@IsString()
	@IsOptional()
	password: string;
}

class CreateRoomDTO {
	@MinLength(3)
	@MaxLength(20)
	@IsString()
	name: string;

	//@IsString()
	@IsEnum(Access)
	access: string;

	@MinLength(3)
	@MaxLength(20)
	@IsString()
	@IsOptional()
	password: string;
}

const NO_SUCH_ROOM = 'room not found';

@Controller('chat')
@UseGuards(AuthGuard, SetupGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class ChatRoomController {
	constructor(
		@Inject('CHATROOM_REPO')
		private readonly chatRepo: Repository<ChatRoom>,
		@Inject('ROOMINVITE_REPO')
		private readonly inviteRepo: Repository<RoomInvite>,
	) {}

	@Post('create')
	@HttpCode(HttpStatus.CREATED)
	async createRoom(@GetUser() user: User, @Body() dto: CreateRoomDTO) {
		const is_private = dto.access === 'private';

		if (is_private && dto.password)
			throw new HttpException(
				'A room cannot be both private and password protected',
				HttpStatus.UNPROCESSABLE_ENTITY,
			);
		if (
			!is_private &&
			(await this.chatRepo.findOneBy({
				name: dto.name,
				access: Not(Access.PRIVATE),
			}))
		)
			throw new HttpException(
				'A room with this name already exists',
				HttpStatus.UNPROCESSABLE_ENTITY,
			);

		const room = new ChatRoom();
		//TODO generate proper random id for room

		room.owner = Promise.resolve(user);
		room.access = is_private
			? Access.PRIVATE
			: dto.password
			? Access.PROTECTED
			: Access.PUBLIC;
		room.name = dto.name;
		try {
			room.password = dto.password
				? await argon2.hash(dto.password)
				: undefined;
		} catch (err) {
			console.error(err);
			throw new HttpException(
				'Could not create room',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
		room.members = Promise.resolve([user]);
		room.admins = Promise.resolve([user]);

		console.log(room);

		return await this.chatRepo.save(room);
	}

	@Post('leave')
	async leave(@GetUser() user: User, @Body() dto: RoomDTO) {
		const room = await this.getRoom(user, dto.id);

		const owner = await room.owner;
		if (user.user_id === owner.user_id)
			throw new HttpException(
				'cannot leave room as owner',
				HttpStatus.FORBIDDEN,
			);

		const admins = await room.admins;
		const admin_idx = admins.findIndex(
			(current: User) => current.user_id == user.user_id,
		);
		if (admin_idx >= 0) admins.splice(admin_idx, 1);

		const members = await room.members;
		const member_idx = members.findIndex(
			(current: User) => current.user_id === user.user_id,
		);
		members.splice(member_idx, 1);

		//TODO send message to all other online members to update their lists
		await this.chatRepo.save(room);
	}

	@Get('info')
	async info(@GetUser() user: User, @Query() dto: RoomDTO) {
		const room = await this.chatRepo.findOneBy({ id: Number(dto.id) });

		//TODO check if you can't get information about a private room you're not a member of
		if (!room || (room.access == Access.PRIVATE && !(await room.has_member(user)))) {
			throw new HttpException(NO_SUCH_ROOM, HttpStatus.NOT_FOUND);
		}
		return room.serialize();
	}

	@Post('promote')
	@HttpCode(HttpStatus.NO_CONTENT)
	async promote(
		@GetUser() user: User,
		@Body() dto: RoomDTO,
		@GetUserQuery() target: User,
	) {
		if (user.user_id === target.user_id)
			throw new HttpException(
				'cannot promote yourself',
				HttpStatus.UNPROCESSABLE_ENTITY,
			);

		const room = await this.getRoom(user, dto.id);

		const admins = await room.admins;
		if (!admins.find((current: User) => current.user_id === user.user_id))
			throw new HttpException(
				'not an admin of this room',
				HttpStatus.FORBIDDEN,
			);

		if (admins.find((current: User) => current.user_id === target.user_id))
			throw new HttpException(
				'user already an admin',
				HttpStatus.TOO_MANY_REQUESTS,
			);

		const members = await room.members;
		if (!members.find((current: User) => current.user_id === target.user_id))
			throw new HttpException('no such user in the room', HttpStatus.NOT_FOUND);

		admins.push(target);
		await this.chatRepo.save(room);
	}

	@Post('demote')
	@HttpCode(HttpStatus.NO_CONTENT)
	async demote(
		@GetUser() user: User,
		@Body() dto: RoomDTO,
		@GetUserQuery() target: User,
	) {
		const room = await this.getRoom(user, dto.id);

		const admins = await room.admins;
		if (!admins.find((current: User) => current.user_id === user.user_id))
			throw new HttpException(
				'not an admin of this room',
				HttpStatus.FORBIDDEN,
			);

		const owner = await room.owner;
		if (user.user_id === owner.user_id && target.user_id === user.user_id)
			throw new HttpException(
				'cannot demote yourself as owner',
				HttpStatus.FORBIDDEN,
			);

		if (owner.user_id !== user.user_id && user.user_id !== target.user_id)
			throw new HttpException(
				'cannot demote other users',
				HttpStatus.FORBIDDEN,
			);

		const target_idx = admins.findIndex(
			(current: User) => current.user_id === target.user_id,
		);
		if (target_idx < 0)
			throw new HttpException(
				'user not an admin of the room',
				HttpStatus.NOT_FOUND,
			);
		admins.splice(target_idx, 1);
		await this.chatRepo.save(room);
	}

	@Post('transfer')
	@HttpCode(HttpStatus.NO_CONTENT)
	async transfer(
		@GetUser() user: User,
		@Body() dto: RoomDTO,
		@GetUserQuery() target: User,
	) {
		const room = await this.getRoom(user, dto.id);
		const owner = await room.owner;
	
		if (user.user_id !== owner.user_id)
			throw new HttpException(
				'not the owner of the room',
				HttpStatus.FORBIDDEN,
			);

		if (user.user_id === target.user_id)
			throw new HttpException(
				'cannot transfer ownership to yourself',
				HttpStatus.UNPROCESSABLE_ENTITY,
			);

		if (!(await room.has_member(target)))
			throw new HttpException(
				'user not member of the room',
				HttpStatus.NOT_FOUND,
			);

		const admins = await room.admins;
		if (!admins.find((current) => current.user_id === target.user_id))
			await room.add_admin(target);

		room.owner = Promise.resolve(target);
		await this.chatRepo.save(room);
	}

	@Post('join')
	@HttpCode(HttpStatus.NO_CONTENT)
	async join(@GetUser() user: User, @Body() dto: JoinRoomDTO) {
		const room = await this.chatRepo.findOneBy({ id: Number(dto.id) });
		if (!room) throw new HttpException(NO_SUCH_ROOM, HttpStatus.NOT_FOUND);

		const members = await room.members;

		const idx = members.findIndex(
			(current: User) => current.user_id === user.user_id,
		);
		if (idx >= 0)
			throw new HttpException(
				'already a member of this room',
				HttpStatus.FORBIDDEN,
			);

		if (room.access === Access.PRIVATE) {
			const room_invites = await Promise.all(
				(
					await room.invites
				).filter(async (invite) => (await invite.to).user_id === user.user_id),
			);
			if (room_invites.length === 0)
				throw new HttpException(NO_SUCH_ROOM, HttpStatus.NOT_FOUND);
			await this.inviteRepo.remove(room_invites);
		} else if (room.access === Access.PROTECTED) {
			if (!dto.password)
				throw new HttpException('password required', HttpStatus.FORBIDDEN);
			let authorized = false;

			//TODO proper HTTP authentication?
			//https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication
			try {
				authorized = await argon2.verify(room.password, dto.password);
			} catch (err) {
				console.error(err);
				throw new HttpException(
					'could not join room',
					HttpStatus.INTERNAL_SERVER_ERROR,
				);
			}
			if (!authorized)
				throw new HttpException('invalid password', HttpStatus.FORBIDDEN);
		}
		await room.add_member(user);
		await this.chatRepo.save(room);
	}

	@Delete('delete')
	@HttpCode(HttpStatus.NO_CONTENT)
	async delete(@GetUser() user: User, @GetRoomQuery() room: any) {
		const owner = await room.owner;
	
		if (owner.user_id !== user.user_id)
			throw new HttpException(
				'only the owner of a room can delete the room',
				HttpStatus.FORBIDDEN,
			);

		await this.chatRepo.remove(room);
	}

	@Post('invite')
	@HttpCode(HttpStatus.NO_CONTENT)
	async invite(
		@GetUser() user: User,
		@GetUserQuery() target: User,
		@Query() dto: RoomDTO,
	) {
		const room = await this.getRoom(user, dto.id);
		const admins = await room.admins;

		if (!admins.find((current) => current.user_id === user.user_id))
			throw new HttpException(
				'only admins can invite users',
				HttpStatus.FORBIDDEN,
			);

		if (user.user_id === target.user_id)
			throw new HttpException(
				'cannot invite yourself',
				HttpStatus.UNPROCESSABLE_ENTITY,
			);

		const members = await room.members;
		if (members.find((current) => current.user_id === target.user_id))
			throw new HttpException(
				'user already member of channel',
				HttpStatus.TOO_MANY_REQUESTS,
			);

		const invite = await this.inviteRepo.findOneBy({
			from: {	user_id: user.user_id },
			to: { user_id: target.user_id },
			room: { id: room.id },
		});
	
		if (invite)
			throw new HttpException(
				'already invited user',
				HttpStatus.TOO_MANY_REQUESTS,
			);

		const room_invite = new RoomInvite();
		room_invite.from = Promise.resolve(user);
		room_invite.to = Promise.resolve(target);
		room_invite.room = Promise.resolve(room);
		await this.inviteRepo.save(room_invite);
	}

	@Get('invites/to')
	async invitesTo(@GetUser() user: User) {
		const invites = await this.inviteRepo.findBy({
			to: { user_id: user.user_id },
		});

		return await Promise.all(
			invites.map(async (invite) => {
				return await invite.serialize();
			}),
		);
	}

	@Get('invites/room')
	async invitesRoom(@GetRoomQuery() room: any) {
		const invites = await this.inviteRepo.findBy({
			room: { id: room.id },
		});

		return await Promise.all(
			invites.map(async (invite) => {
				return await invite.serialize();
			})
		);
	}

	async getRoom(user: User, id: string): Promise<ChatRoom> {
		const room = await this.chatRepo.findOneBy({ id: Number(id) });
		if (!room) 
			throw new HttpException(NO_SUCH_ROOM, HttpStatus.NOT_FOUND);

		const members = await room.members;
		if (
			room.access == Access.PRIVATE &&
			!members.find((current: User) => current.user_id === user.user_id)
		)
			throw new HttpException(NO_SUCH_ROOM, HttpStatus.NOT_FOUND);
		return room;
	}
}
