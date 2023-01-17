import { HttpException, HttpStatus, Inject } from '@nestjs/common';
import {
	MessageBody,
	SubscribeMessage,
	WebSocketGateway,
	WebSocketServer,
	ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { ChatRoom } from './entities/ChatRoom';
import { Message } from './entities/Message';
import { User } from './entities/User';
import { authorize } from './auth/auth.guard';

@WebSocketGateway({
	namespace: "room",
	cors: { origin: 'http://localhost:5173', credentials: true },
})
export class WSConnection {
	@WebSocketServer()
	server: Server;

	constructor(
		@Inject('CHATROOM_REPO')
		private readonly chatroomRepo: Repository<ChatRoom>,
		@Inject('USER_REPO')
		private readonly userRepo: Repository<User>,
		@Inject('MESSAGE_REPO')
		private readonly messageRepo: Repository<Message>
		) {
	}

	async handleConnection(client: Socket) {
		const request: any = client.request;
	
		if (!request.session || !authorize(request.session)) {
			client.emit('exception', { errorMessage: 'unauthorized' });
			client.disconnect();
		}
	}

	@SubscribeMessage('join')
	join(@ConnectedSocket() client: Socket, @MessageBody() id: string) {
		client.join(id);
	}

	@SubscribeMessage('message')
	async message(@ConnectedSocket() client: Socket, @MessageBody() data: { room_id: string, content: string }) {
		const request: any = client.request;
		const user = await this.userRepo.findOneBy({ user_id: request.session.user_id });
	
		if (!user)
			throw new HttpException('user not found', HttpStatus.NOT_FOUND);

		this.server.in(data.room_id).emit("message", {
			user: {
				username: user.username,
				avatar: user.avatar,
			},
			content: data.content
		});
	
		const message = new Message;
	
		message.user = Promise.resolve(user);
		message.room = Promise.resolve(await this.chatroomRepo.findOneBy({ id: Number(data.room_id) }));
		message.content = data.content;
		// TODO check if number, private room

		await this.messageRepo.save(message);
	}
}
