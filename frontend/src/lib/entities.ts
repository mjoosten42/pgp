import type { Achievement } from "./types";
import type { Access, Role, Status, Gamemode } from "./enums";

export type User = {
	id: number,
	auth_req?: number,
	username: string,
	status: Status,
	avatar: string,
	in_game: boolean,
	achievements?: Achievement[],
	invites?: any[],
};

export type Room = {
    id: number,
    name: string,
	access: Access,
	type: "ChatRoom" | "GameRoom",
	owner: User,
	joined?: boolean,	
};

export type ChatRoom = Room & {
	// messages: Message[],
};

export type GameRoom = Room & {
	state: GameState,
	gamemode: Gamemode,
	teamsLocked: boolean,
	teams: Team[],
};

export type GameState = {
	teamsLocked: boolean,
	gamemode: Gamemode,
	teams: Team[],
}

export type Member = {
	id: number,
	user: User,
	role: Role,
	is_muted: boolean,
};

export type GameRoomMember = Member & {
	player: Player | null,
};

export type Player = {
	team: Team,
};

export type Team = {
	id: number,
	name: string,
};

export type Invite = {
	id: number,
	date: Date,
	from: User,
	to: User,
	type: "Room" | "ChatRoom" | "GameRoom" | "Friend",
	room?: Room,
};

export type Embed = {
	digest: string;
	url: string;
};

export type Message = {
	id: number,
	content: string,
	member: Member,
	created: string,
	embeds: Embed[],
};