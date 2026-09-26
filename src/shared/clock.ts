// Nguồn thời gian được inject, để test cooldown và thời hạn mà không phải chờ thời gian thật.
export interface Clock
{
	now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
