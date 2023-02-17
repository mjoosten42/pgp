import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn, AfterInsert, BeforeRemove, CreateDateColumn, TableInheritance, AfterUpdate } from "typeorm";
import { Room } from "./Room";
import { Role } from "src/enums/Role";
import { User } from "./User";
import { Exclude, Expose, instanceToPlain } from "class-transformer";
import { Message } from "./Message";
import { Subject } from "src/enums/Subject";
import { Action } from "src/enums/Action";
import { UpdateGateway } from "src/gateways/update.gateway";

@Entity()
@TableInheritance({ column : { type: "varchar", name: "type" } })
export class Member {
	@PrimaryGeneratedColumn()
	id: number;

	@ManyToOne(() => User, (user) => user.members, { onDelete: "CASCADE" })
	user: User;

	@ManyToOne(() => Room, { onDelete: "CASCADE", cascade: [ "insert", "update" ]})
	room: Room;

	@Column({
		type: "enum",
		enum: Role,
		default: Role.MEMBER,
	})
	role: Role;

	@Exclude()
	@OneToMany(() => Message, (message) => message.member)
	messages: Message[];

	@Exclude()
	@CreateDateColumn()
	mute: Date;

	@Expose()
	get is_muted(): boolean {
		return this.mute > new Date;
	}

	async send_update(action: Action) {
		await UpdateGateway.instance.send_update({
			subject: Subject.MEMBER,
			id: this.id,
			action,
			value: instanceToPlain(this),
		}, ...(this.room?.users || []));
	}

	@AfterInsert()
	async afterInsert() {
		await this.send_update(Action.ADD);
	}

	@AfterUpdate()
	async afterUpdate() {
		await this.send_update(Action.SET);
	}

	@BeforeRemove()
	async beforeRemove() {
		await this.send_update(Action.REMOVE);
	}
}
