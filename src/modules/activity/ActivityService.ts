import { Db } from "../../db/connection";
import { ServiceDeps } from "../deps";
import { ActivityProfile, ActivityServiceApi, MessageInput, MessageXpResult, XpAdjustInput, XpEventView } from "./types";

// PLACEHOLDER của foundation: chỉ để code compile; sẽ được thay bằng implementation thật.
export class ActivityService implements ActivityServiceApi
{
	constructor(private readonly db: Db, private readonly deps: ServiceDeps)
	{}

	handleMessage(_input: MessageInput): MessageXpResult
	{
		throw new Error("ActivityService.handleMessage chưa được triển khai.");
	}

	getProfile(_guildId: string, _userId: string): ActivityProfile
	{
		throw new Error("ActivityService.getProfile chưa được triển khai.");
	}

	adjustXp(_input: XpAdjustInput): { totalXp: number }
	{
		throw new Error("ActivityService.adjustXp chưa được triển khai.");
	}

	resetUser(_guildId: string, _userId: string, _actorId: string): { voidedEvents: number }
	{
		throw new Error("ActivityService.resetUser chưa được triển khai.");
	}

	resetAll(_guildId: string, _actorId: string): { voidedEvents: number; members: number }
	{
		throw new Error("ActivityService.resetAll chưa được triển khai.");
	}

	recentEvents(_guildId: string, _userId: string, _limit: number): XpEventView[]
	{
		throw new Error("ActivityService.recentEvents chưa được triển khai.");
	}
}
