import { Db } from "../../db/connection";
import { ServiceDeps } from "../deps";
import { GamificationProfile, GamificationServiceApi } from "./types";

/** Cảnh giới, chuỗi ngày hoạt động, huy hiệu và XP tuần (DEC-029). Chỉ đọc dữ liệu, không ghi gì. */
export class GamificationService implements GamificationServiceApi
{
	constructor(private readonly db: Db, private readonly deps: ServiceDeps)
	{}

	profile(guildId: string, userId: string): GamificationProfile
	{
		throw new Error(`Chưa triển khai: GamificationService.profile (${guildId}, ${userId}, ${this.db.name}, ${typeof this.deps}).`);
	}
}
