import { Inject } from "@nestjs/common";
import { User } from "src/entities/User";
import { Team } from "src/entities/Team";
import { GameState} from "src/entities/GameState"
import { MessageBody, SubscribeMessage, ConnectedSocket } from "@nestjs/websockets";
import { Socket } from "socket.io";
import { Repository, In } from "typeorm"
import { GameRoom } from "src/entities/GameRoom";
import { GameRoomMember } from "src/entities/GameRoomMember";
import { ProtectedGateway } from "src/gateways/protected.gateway";
import { UpdateGateway } from "src/gateways/update.gateway"
import { Action, Subject } from "src/enums"
import { instanceToPlain } from "class-transformer"

type BroadcastData = {
	name: "update" | "synchronize" | "desync-check",
	snapshot: {
		state: {
			teams: Team[],
		},
	},
}

export class GameGateway extends ProtectedGateway("game") {
	constructor(
		@Inject("USER_REPO")
		readonly userRepo: Repository<User>,
		@Inject("GAMEROOM_REPO")
		private readonly roomRepo: Repository<GameRoom>,
		@Inject("GAMEROOMMEMBER_REPO")
		private readonly memberRepo: Repository<GameRoomMember>,
		@Inject("GAMESTATE_REPO")
		private readonly gameStateRepo: Repository<GameState>,
		@Inject("TEAM_REPO")
		private readonly teamRepo: Repository<Team>,
	) {
		super(userRepo);
	}

	async onDisconnect(client: Socket) {
		await this.userRepo.save({ id: client.user.id, activeRoom: null });

		UpdateGateway.instance.send_update({
			subject: Subject.USER,
			action: Action.UPDATE,
			id: client.user.id,
			value: { activeRoomId: null }
		});
	}

	async onJoin(client: Socket) {
		await this.userRepo.save({ id: client.user.id, activeRoom: { id: client.room }});
	
		client.join(String(client.room));
	
		UpdateGateway.instance.send_update({
			subject: Subject.USER,
			action: Action.UPDATE,
			id: client.user.id,
			value: { activeRoomId: client.room }
		});

		const state = await this.gameStateRepo.findOneBy({ room: { id: client.room } });
		const friends = await this.userRepo.findBy({ friends: { id: client.user.id }});

		UpdateGateway.instance.send_update({
			subject: Subject.GAMESTATE,
			action: Action.UPDATE,
			id: state.id,
			value: instanceToPlain(state),
		}, ...[client.user, ...friends]);
	}

	@SubscribeMessage("broadcast")
	async broadcast(@ConnectedSocket() client: Socket, @MessageBody() data: BroadcastData) {
		client.to(String(client.room)).emit("broadcast", data);

		if (data.name === "synchronize") {
			data.snapshot.state.teams.forEach(async (team) => {
				await this.teamRepo.save({ id: team.id, score: team.score });

				UpdateGateway.instance.send_state_update({ id: client.room }, { teams: [{ id: team.id, score: team.score }]});	

			});

		}
	}

	@SubscribeMessage("ping")
	ping(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
		client.emit("pong", data);
	}
}
