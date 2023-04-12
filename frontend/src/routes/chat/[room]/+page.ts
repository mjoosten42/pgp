import type { PageLoad } from "./$types"
import { Entity, User, ChatRoom, ChatRoomMember, type Message } from "$lib/entities";
import { userStore, roomStore, memberStore, updateStore  } from "$lib/stores";
import { Role } from "$lib/enums"
import { unwrap } from "$lib/Alert";
import { get } from "$lib/Web";

export const load: PageLoad = (async ({ fetch, params }) => {
	window.fetch = fetch;

	const room: ChatRoom = await unwrap(get(`/chat/${params.room}`));
	const users: User[] = await unwrap(get(`/chat/${params.room}/users`));
	const members: ChatRoomMember[] = await unwrap(get(`/chat/${params.room}/members`));
	const messages: Message[] = await unwrap(get(`/chat/${params.room}/messages`));

	updateStore(User, users);
	updateStore(ChatRoom, room);
	updateStore(ChatRoomMember, members);

	let banned: User[] | null = null;

	if (room.self!.role >= Role.ADMIN) {
		banned = await unwrap(get(`/chat/${params.room}/bans`)) as User[];
	
		updateStore(User, banned);
	}

    return { room, members, messages, banned };
}) satisfies PageLoad;