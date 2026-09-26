import { Db } from "../../db/connection";
import { ServiceDeps } from "../deps";
import { CreatePollInput, Poll, PollServiceApi, PollVoteResult } from "./types";

// PLACEHOLDER của foundation: chỉ để code compile; sẽ được thay bằng implementation thật.
export class PollService implements PollServiceApi
{
	constructor(private readonly db: Db, private readonly deps: ServiceDeps)
	{}

	create(_input: CreatePollInput): Poll
	{
		throw new Error("PollService.create chưa được triển khai.");
	}

	attachMessage(_guildId: string, _pollId: number, _channelId: string, _messageId: string): void
	{
		throw new Error("PollService.attachMessage chưa được triển khai.");
	}

	get(_guildId: string, _pollId: number): Poll | null
	{
		throw new Error("PollService.get chưa được triển khai.");
	}

	vote(_input: { guildId: string; pollId: number; userId: string; optionIndex: number; roleIds: readonly string[] }): PollVoteResult
	{
		throw new Error("PollService.vote chưa được triển khai.");
	}

	close(_input: { guildId: string; pollId: number; actorId: string; actorIsAdmin: boolean }): Poll
	{
		throw new Error("PollService.close chưa được triển khai.");
	}

	closeDue(): Poll[]
	{
		throw new Error("PollService.closeDue chưa được triển khai.");
	}

	listOpen(_guildId: string): Poll[]
	{
		throw new Error("PollService.listOpen chưa được triển khai.");
	}
}
