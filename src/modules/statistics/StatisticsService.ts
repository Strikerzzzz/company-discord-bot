import { Db } from "../../db/connection";
import { ServiceDeps } from "../deps";
import { GuildStatistics, StatisticsServiceApi } from "./types";

// PLACEHOLDER của foundation: chỉ để code compile; sẽ được thay bằng implementation thật.
export class StatisticsService implements StatisticsServiceApi
{
	constructor(private readonly db: Db, private readonly deps: ServiceDeps)
	{}

	summary(_guildId: string): GuildStatistics
	{
		throw new Error("StatisticsService.summary chưa được triển khai.");
	}
}
