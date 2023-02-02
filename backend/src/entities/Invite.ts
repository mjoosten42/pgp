import { User } from "./User";
import {
	Entity,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	ManyToOne,
	TableInheritance,
} from "typeorm";
import { Exclude, instanceToPlain } from "class-transformer";

@Entity()
@TableInheritance({ column : { type: "varchar", name: "type" } })
export class Invite {
	@PrimaryGeneratedColumn()
	id: number;

	@CreateDateColumn({ type: 'timestamptz' })
	date: Date;

	@ManyToOne(() => User, (user) => user.sent_invites, { onDelete: "CASCADE" })
	from: User;

	@ManyToOne(() => User, (user) => user.received_invites, { onDelete: "CASCADE" })
	to: User;
}
