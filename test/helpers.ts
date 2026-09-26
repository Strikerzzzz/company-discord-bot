import { Db, openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";
import { AuditService } from "../src/modules/audit/AuditService";
import { ServiceDeps } from "../src/modules/deps";
import { GuildConfigService } from "../src/modules/guild-config/GuildConfigService";
import { Ledger } from "../src/modules/ledger/Ledger";
import { TeamService } from "../src/modules/team/TeamService";
import { Clock } from "../src/shared/clock";

/** Đồng hồ giả: thời gian chỉ đổi khi test gọi advance(). */
export class FakeClock implements Clock
{
	constructor(public current = Date.UTC(2026, 0, 1, 0, 0, 0))
	{}

	now(): number
	{
		return this.current;
	}

	advance(ms: number): void
	{
		this.current += ms;
	}

	advanceSeconds(seconds: number): void
	{
		this.current += seconds * 1000;
	}
}

export interface TestContext
{
	db: Db;
	clock: FakeClock;
	deps: ServiceDeps;
}

/** Database SQLite trong bộ nhớ đã chạy migration thật, cùng các service nền dùng dữ liệu thật (không mock). */
export function createTestContext(): TestContext
{
	const db = openDatabase(":memory:");
	runMigrations(db);
	const clock = new FakeClock();
	const audit = new AuditService(db, clock);
	return {
		db,
		clock,
		deps: {
			clock,
			audit,
			guildConfig: new GuildConfigService(db, clock, audit),
			teams: new TeamService(db, clock, audit),
			xpLedger: new Ledger(db, "xp", clock),
			contributionLedger: new Ledger(db, "contribution", clock),
		},
	};
}

// ID mẫu dạng Discord snowflake.
export const GUILD = "100000000000000001";
export const OTHER_GUILD = "100000000000000002";
export const ADMIN = "200000000000000001";
export const USER_A = "300000000000000001";
export const USER_B = "300000000000000002";
export const USER_C = "300000000000000003";
export const CHANNEL_GENERAL = "400000000000000001";
export const CHANNEL_BOT = "400000000000000002";
export const ROLE_BACKEND = "500000000000000001";
export const ROLE_FRONTEND = "500000000000000002";
export const ROLE_OTHER = "500000000000000009";
