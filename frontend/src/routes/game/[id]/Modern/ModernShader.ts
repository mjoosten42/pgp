import { Net } from "../Net";
import type { Event as NetEvent } from "../Net";
import {intersection, Vector, paddleBounce, isInConvexHull} from "../lib2D/Math2D";
import type { VectorObject, Line, CollisionLine } from "../lib2D/Math2D";
import { Paddle } from "./Paddle";
import { WIDTH, HEIGHT, UPS, border, FIELDWIDTH, FIELDHEIGHT, levels, PADDLE_PING_INTERVAL, PADDLE_PING_TIMEOUT, ballVelociy } from "./Constants";
import { GAME, type field} from "./Constants";
import { Ball } from "./Ball";
import type { Snapshot, Options, PingEvent } from "../lib2D/interfaces";
import { Field } from "./Field";
import { Score } from "./Score";
import { Team } from "../lib2D/Team";

const hit = new Audio("/Assets/sounds/laser.wav");
const scoreSound = new Audio("/Assets/sounds/teleportation.mp3");
const wall = new Audio("/Assets/sounds/wall.wav");
const music = new Audio("/Assets/sounds/zetauri.wav");

//This is not from interfaces because my MouseEvent needs a vectorObject
export interface MouseEvent extends NetEvent {
	u: number; //userid
	x: number; //xpos
	y: number; //ypos
	t: number; //teamId
	r: number; //rotation
}

export interface ScoreEvent extends NetEvent {
	u: number; //userId that is sending the event
	t: number; //teamId of team that is being updated
	s: number; //scorechange
}

function moveCollision(paddleLines: CollisionLine[], paddleVelo: Vector, ball: Ball) {

	const ballLine: Line = {p0: ball.position, p1: ball.position.add(paddleVelo), name: "ballLine"};
	let closest: [Line, Vector, number] | null = null;
	let other = [];
	for (let line of paddleLines) {
		const [t0, t1] = intersection([ballLine.p0, paddleVelo], [line.p0, line.p1.sub(line.p0)]);
		other.push([t0, t1] );
		if (t1 >= 0 && t1 <= 1 && t0 > -0.001)
		{
			if (closest === null || t0 < closest[2]) {
				const pos = ball.position.add(paddleVelo.scale(t0));
				let newLine: Line = {p0: line.p0, p1: line.p1, name: line.name};
				closest = [newLine, pos, t0];
			}
		}
	}
	if (closest !== null) {
		return {closest: closest, other: other}
	}
	return {closest: null, other: other};
}

import { FullShader } from "./Shader/fullShader";

export class Game extends Net {
	public ball: Ball;
	public paddles: Array<Paddle>;
	public field: Field;
	public players: GAME;
	public level: field;
	public score?: Score;
	public teams: Array<Team>;
	public shader: FullShader;

	public constructor(players: GAME, level: field, shader: FullShader) {
		super();
		this.level = level;
		this.players = players;
		this.ball = new Ball();
		this.paddles = [];
		this.teams = [];
		this.paddles = [];
		this.field = new Field(this.level);
		this.shader = shader;

		this.on("mousemove", netEvent => {
			const event = netEvent as MouseEvent;
			let paddle = this.getPaddle(event.u);

			if (paddle === null) {
				paddle = this.paddles.find(p => p.team.id == event.t) ?? null;
				if (paddle?.userID !== undefined) {
					paddle = null;
				}
			}
			if (paddle !== null) {
				paddle.userID = event.u;
				paddle.ping = this.time;

				const oldPos = new Vector(paddle.position.x, paddle.position.y);
				const oldLines = paddle.getCollisionLines();

				if (paddle.isInPlayerArea(new Vector(paddle.position.x + event.x, paddle.position.y), this.field.getPlayerAreas()[paddle.owner]))
					paddle.position.x += event.x;
				if (paddle.isInPlayerArea(new Vector(paddle.position.x, paddle.position.y + event.y), this.field.getPlayerAreas()[paddle.owner]))
					paddle.position.y += event.y;
				
				this.shader.movePaddle(paddle.position, paddle.owner);
				const paddleMovement = new Vector((paddle.position.x - oldPos.x), (paddle.position.y - oldPos.y));
				const negvelocity = paddleMovement.scale(-1);
				
				const closest = moveCollision(oldLines, negvelocity, this.ball).closest;
				let otherclosest = [];
				let ballpos = [];
				if (closest && closest[2] < 1) {
					this.bounceBall(closest, paddleMovement);
					ballpos.push(this.ball.position);
					let i = 0;
					while (true) {
						i+=1;
						const col = moveCollision(paddle.getCollisionLines(), this.ball.velocity, this.ball).closest;
						otherclosest.push(col);
						if (col && col[2] < 1) {
							this.bounceBall(col, paddleMovement);
							ballpos.push(this.ball.position);
						}
						else break;
					}
				}
			}
		});

		this.on("mousescroll", netEvent => {
			//TODO do a check for if after rotation ball gets inside paddle
			//TODO check if rotation causes paddle to get outside player field
			const event = netEvent as MouseEvent;
			let paddle = this.getPaddle(event.u);

			if (paddle === null) {
				paddle = this.paddles.find(p => p.team.id == event.t) ?? null;
				if (paddle?.userID !== undefined) {
					paddle = null;
				}
			}
			if (paddle !== null) {
				paddle.userID = event.u;
				paddle.ping = this.time;

				paddle.rotation += event.r;
				this.shader.rotatePaddle(paddle.rotation, paddle.owner);
			}
		});

		this.on("ping", netEvent => {
			const event = netEvent as PingEvent;
			const paddle = this.getPaddle(event.u);

			if (paddle !== null) {
				paddle.ping = this.time;
			}
		});
	}

	private bounceBall(closest: [Line, Vector, number], vel: Vector) {	
		hit.play();
		this.ball.position = closest[1];
		this.ball.velocity = this.ball.velocity.reflect(closest[0].p1.sub(closest[0].p0));

		const magnitude = this.ball.velocity.magnitude() + 0.1;
		this.ball.velocity = this.ball.velocity.normalize();
		this.ball.velocity = paddleBounce(closest[0], this.ball);
		this.ball.velocity = this.ball.velocity.normalize().scale(magnitude);
		this.ball.velocity = this.ball.velocity.add(vel.scale(1 / UPS));
		this.ball.position = this.ball.position.add(vel.scale(1.001));
		if (!isInConvexHull(this.ball.position, this.field.getConvexFieldBoxLines(), true)) {
			console.log("ERROR: ball outside field. Resetting position.");
			this.ball.position = new Vector(WIDTH / 2, HEIGHT /2);
			this.ball.velocity = this.ball.velocity.tangent();
		}
		for (let paddle of this.paddles) {
			if (isInConvexHull(this.ball.position, paddle.getCollisionLines(), false)) {
				if (isInConvexHull(closest[1], paddle.getCollisionLines(), false))
				{
					console.log("ERROR: ball in paddle.");
				}
			}
		}
		this.shader.moveBall(this.ball.position);
	}

	protected save(): Snapshot {
		return {
			ball: this.ball.save(),
			paddles: this.paddles.map(paddle => paddle.save()),
			state: {teams: this.teams.map(team => team.save()),
			},
			...super.save(),
		};
	}

	protected load(snapshot: Snapshot) {
		this.ball.load(snapshot.ball);
		this.paddles.forEach((paddle, i) => paddle.load(snapshot.paddles[i]));
		this.teams.forEach((team, i) => team.load(snapshot.state.teams[i]));
		super.load(snapshot);
	}

	public getPaddle(userID?: number): Paddle | null {
		for (let paddle of this.paddles) {
			if (paddle.userID === userID) {
				return paddle;
			}
		}

		return null;
	}

	//TODO lerp/slerp the paddle (and ball?) for smoother motion

	//TODO move as much as possible outside of lateTick please
	public lateTick() {
		let time = 1;
		const maxSpeed = 30;
		while (time > 0) {
			let collisionLines: CollisionLine[] = [];
			collisionLines.push(...this.level.collisions);
			this.paddles.forEach((paddle) => {
				collisionLines.push(...paddle.getCollisionLines());
			});
			const collision = this.ball.collision(collisionLines);
			if (collision === null || collision[2] > time + 0.001) {
				this.ball.position = this.ball.position.add(this.ball.velocity.scale(time));
				break;
			} else if (collision[0].name.startsWith("goal")) {
				scoreSound.play();
				let goal: number = +collision[0].name.charAt(4);
				if (this.level.players > 2)
					this.teams[goal].score -= 1;
				else if (goal === 1) {
					goal = 0;
					this.teams[goal].score += 1;
				}
				else {
					goal = 1;
					this.teams[goal].score += 1;
				}
				//TODO reimplement the ripples again
				// setOriginRipple(this.ball.position.x, this.ball.position.y);
				// activateRipple();
				this.ball.position = new Vector(FIELDWIDTH / 2, FIELDHEIGHT / 2);
				this.ball.velocity = new Vector(ballVelociy[this.players][goal].x, ballVelociy[this.players][goal].y);
				
				break;
			} else {
				if (collision[0].name.startsWith("paddle")) {
					this.bounceBall(collision,  new Vector(0, 0));
				}
				else {
					wall.play();
					this.ball.position = collision[1];
					this.ball.velocity = this.ball.velocity.reflect(collision[0].p1.sub(collision[0].p0));
				}
				time -= collision[2];
			}
			
			if (this.ball.velocity.magnitude() > maxSpeed)
				this.ball.velocity = this.ball.velocity.scale(maxSpeed / this.ball.velocity.magnitude());
		}
		if (this.ball.velocity.magnitude() > maxSpeed)
				this.ball.velocity = this.ball.velocity.scale(maxSpeed / this.ball.velocity.magnitude());

		for (let paddle of this.paddles) {
			if (paddle.ping + PADDLE_PING_TIMEOUT < this.time) {
				paddle.userID = undefined;
			}
		}

		if (this.ball.position.x < -2 * border || this.ball.position.x > this.field.width + 2 * border ||
			this.ball.position.y < 90 - this.field.height / 2 - border || this.ball.position.y > 90 + this.field.height / 2 + border)
		{
			console.log("pos: ", this.ball.position.x);
			console.log("ERROR: ball outside field. Resetting position.");
			this.ball.position = new Vector(WIDTH / 2, HEIGHT /2);
			this.ball.velocity = this.ball.velocity.tangent();
		}
		this.shader.moveBall(this.ball.position);
		super.lateTick();
	}

	public async start(options: Options) {
		this.teams = [];
		let startScore = 0;
		if (this.players === GAME.FOURPLAYERS)
			startScore = 10;
		for (let i = 0; i < this.level.players; i++) {
			this.teams.push(new Team(options.room.teams[i].id, startScore));
		}

		let index = 0;
		for (let paddle of this.level.paddles) {
			this.paddles.push(new Paddle(new Vector(paddle.x, paddle.y), paddle.angle, paddle.cf, paddle.cs, index, this.teams[index]))
			this.shader.movePaddle({x: paddle.x, y: paddle.y}, index);
			this.shader.rotatePaddle(paddle.angle, index);
			index +=1;
		}
		this.score = new Score(this.teams);
		super.start(options);
		music.loop = true;
		music.muted = false;
		music.volume = 0.5;
		music.play();
	}
}

//TODO fix the collissionlines, either by using the actual lines or updating them
export class Modern {
	private shader?: FullShader;
	private game: Game | null;
	private lastTime?: number;
	private players: GAME;
	private field: field | null;
	private interval?: number;
	private options?: Options;

	public async init(canvas: HTMLCanvasElement) {
		const rest = await fetch(levels[this.players]).then(res => res.json()).then(data => {
			this.field = data;
			this.shader = new FullShader(canvas, data);
			this.game = new Game(this.players, this.field!, this.shader);
			this.shader?.addEventListener(this);
		});
	}

	public constructor(players: number) {
		this.players = players;
		this.field = null;
		this.game = null;
		
	}

	public update(time: number) {
		this.lastTime ||= time;
		while (time - this.lastTime > 1000 / UPS) {
			this.game?.tick();
			this.lastTime += 1000 / UPS;
		}
		this.shader?.update(time);		
	}

	public async start(options: Options) {
		this.options = options;
		this.interval = setInterval(() => {
			this.game?.send("ping", {
				u: options.member.user.id,
			});
		}, 1000 / PADDLE_PING_INTERVAL);

		await this.game?.start(options);
	}

	public mousemove(moveX: number, moveY: number) {
		if (!this.options) {
			return;
		}
			if (this.options.member.player != null) {
			this.game!.send("mousemove", {
				u: this.options.member.userId,
				x: moveX,
				y: moveY,
				t: this.options.member.player?.team?.id,
			});
		}
	}

	//TODO add a middleclick to reset rotation
	public mouseWheel(deltaY: number) {
		if (!this.options) {
			return;
		}	
		if (this.options.member.player != null && this.players === GAME.FOURPLAYERS) {
			this.game!.send("mousescroll", {
				u: this.options.member.userId,
				x: 0,
				y: 0,
				t: this.options.member.player?.team?.id,
				r: deltaY
			});
		}
	}

	public stop() {
		this.game!.stop();
		clearInterval(this.interval);
		music.loop = false;
		music.muted = true;
	}
}