import { Controller, Get, Injectable, Logger, Module, Req, Res, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthGuard, PassportModule, PassportStrategy } from '@nestjs/passport';
import { MessageBody, SubscribeMessage, WebSocketGateway, WsResponse, WebSocketServer, GatewayMetadata, ConnectedSocket, WsException } from '@nestjs/websockets';
import { Response } from 'express';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Server, Socket } from 'socket.io';
import { HttpService } from '@nestjs/axios';

@WebSocketGateway({ cors: { origin: 'http://0.0.0.0:8080', credentials: true } })
class EventHandler {
	@WebSocketServer()
	server: Server;

	async handleConnection(client: Socket, ...args: any[]) {
		console.log('cookies: ' + client.handshake.headers.cookie);
		setInterval(() => client.emit('kaas', 'jouw kaas'), 1000);
	}

	@SubscribeMessage('kaas')
	async getKaas(@ConnectedSocket() client: Socket, @MessageBody() data: any): Promise<any> {
		console.log(data);
		if (!client.handshake.headers.cookie) {
			throw new WsException('forbidden');
		}
		return 'mijn kaas';
	}

	/*
	@SubscribeMessage('kaas')
	getHello(@MessageBody() data: any): Observable<WsResponse<string>> {
		return from('Hello World!').pipe(map(thing => ({ event: 'events', data: thing })));
	}
   */
}

@Injectable()
class AuthStrategy extends PassportStrategy(OAuth2Strategy, 'oauth2') {
	constructor() {
		super({
			authorizationURL: 'https://api.intra.42.fr/oauth/authorize',
			tokenURL: 'https://api.intra.42.fr/oauth/token',
			clientID: process.env.CLIENT_ID,
			clientSecret: process.env.CLIENT_SECRET,
			callbackURL: 'http://0.0.0.0:3000/oauth/get_token',
			passReqToCallback: true,
			scope: 'public',
		});
	}

	async validate(request: any, accessToken: string, refreshToken: string, profile, done: (err, user) => void) {
		try {
			const user = { accessToken };
			console.log("hello");
			done(null, user);
		} catch (err) {
			console.log("no");
			done(err, false);
		}
	}
}

@Controller('oauth')
class AppController {

	@Get('hello')
	//@UseGuards(AuthGuard('bearer'))
	getMessage(@Req() req): string {
		console.log(req.session);
		return "Hello There";
	}

	@Get('login')
	@UseGuards(AuthGuard('oauth2'))
	async login() {
		Logger.log('login');
		return "Hello World";
	}

	@Get('get_token')
	@UseGuards(AuthGuard('oauth2'))
	async getToken(@Req() req, @Res() res: Response) {
		try {
			res.cookie('oauth2', req.user.accessToken, { sameSite: 'none' });
			res.redirect('http://0.0.0.0:8080');
			return res.send();
		} catch (e) {
			return res.send(e);
		}
	}
}

@Module({
	imports: [PassportModule.register({ defaultStrategy: 'oauth2', session: false })],
	controllers: [AppController],
	providers: [AuthStrategy, EventHandler],
})
class AppModule { }

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	app.enableCors();
	await app.listen(3000);
}
bootstrap();
