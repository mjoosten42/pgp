import { Inject, Injectable, NestMiddleware, HttpException, HttpStatus } from "@nestjs/common";
import { Room } from "src/entities/Room";
import { validate_id } from "src/util";
//import type { Request, Response } from "express";
import { Repository } from "typeorm";

@Injectable()
export class RoomMiddleware implements NestMiddleware {
	constructor(
		@Inject("ROOM_REPO")
		private readonly repo: Repository<Room>
	) {}

	//TODO use types for req and res
	async use(req: any, res: any, next: (error?: any) => void) {
		let id;
	       
		try {
			id = validate_id(req.params.id);
			const room = await this.repo.findOne({
				relations: {
					members: true,
					invites: true,
				},
				where: {
					id: id,
				},
			});
			if (!room)
				throw new HttpException("room not found", HttpStatus.NOT_FOUND);
			req.room = room;
		} catch (error) {
		}
		next();
	}
}
