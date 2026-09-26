import { Db } from "../../db/connection";
import { ServiceDeps } from "../deps";
import {
	Contribution,
	ContributionAdjustInput,
	ContributionProfile,
	ContributionServiceApi,
	ContributionVoteResult,
	SubmitContributionInput,
} from "./types";

// PLACEHOLDER của foundation: chỉ để code compile; sẽ được thay bằng implementation thật.
export class ContributionService implements ContributionServiceApi
{
	constructor(private readonly db: Db, private readonly deps: ServiceDeps)
	{}

	submit(_input: SubmitContributionInput): Contribution
	{
		throw new Error("ContributionService.submit chưa được triển khai.");
	}

	attachMessage(_guildId: string, _contributionId: number, _channelId: string, _messageId: string): void
	{
		throw new Error("ContributionService.attachMessage chưa được triển khai.");
	}

	get(_guildId: string, _contributionId: number): Contribution | null
	{
		throw new Error("ContributionService.get chưa được triển khai.");
	}

	list(_guildId: string, _options: { authorId?: string; limit: number }): Contribution[]
	{
		throw new Error("ContributionService.list chưa được triển khai.");
	}

	toggleVote(_input: { guildId: string; contributionId: number; voterId: string }): ContributionVoteResult
	{
		throw new Error("ContributionService.toggleVote chưa được triển khai.");
	}

	remove(_guildId: string, _contributionId: number, _actorId: string): Contribution
	{
		throw new Error("ContributionService.remove chưa được triển khai.");
	}

	adjust(_input: ContributionAdjustInput): { score: number }
	{
		throw new Error("ContributionService.adjust chưa được triển khai.");
	}

	resetUser(_guildId: string, _userId: string, _actorId: string): { voidedEvents: number }
	{
		throw new Error("ContributionService.resetUser chưa được triển khai.");
	}

	resetAll(_guildId: string, _actorId: string): { voidedEvents: number; members: number }
	{
		throw new Error("ContributionService.resetAll chưa được triển khai.");
	}

	getProfile(_guildId: string, _userId: string): ContributionProfile
	{
		throw new Error("ContributionService.getProfile chưa được triển khai.");
	}
}
