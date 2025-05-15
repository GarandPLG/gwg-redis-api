import { serve } from 'bun';
import { createClient } from 'redis';

const client = createClient({
	url: Bun.env.IS_DOCKER ? 'redis://redis-stack:6379' : 'redis://localhost:6379'
});

client.on('error', (err: Error) => console.error('Redis Client Error', err));
await client.connect();

const healthCheck = async () => {
	try {
		await client.ping();
		return { status: 'OK' };
	} catch (error: unknown) {
		return {
			status: 'ERROR',
			message: error instanceof Error ? error.message : 'Nieznany błąd'
		};
	}
};

const handleRedisAction = async (
	method: string,
	key?: string,
	value?: any,
	ttl?: number,
	type: string = 'string'
) => {
	switch (method) {
		case 'GET':
			if (!key) return { error: 'Brak klucza' };

			const keyExists = await client.exists(key);
			if (!keyExists) return { value: null, type: null };

			const valueType = await client.type(key);
			switch (valueType) {
				case 'string':
					const getValue = await client.get(key);
					return { value: getValue ? JSON.parse(getValue) : null, type: valueType };

				case 'list':
					const getList = await client.lRange(key, 0, -1);
					return {
						value: getList ? getList.map(item => JSON.parse(item)) : [],
						type: valueType
					};

				case 'hash':
					const getHash = await client.hGetAll(key);
					const parsedHash = Object.fromEntries(
						Object.entries(getHash).map(([k, v]) => [k, JSON.parse(v)])
					);
					return { value: parsedHash || {}, type: valueType };

				case 'set':
					const getSet = await client.sMembers(key);
					return {
						value: getSet ? getSet.map(item => JSON.parse(item)) : [],
						type: valueType
					};

				default:
					return { error: 'Nieobsługiwany typ danych' };
			}

		case 'POST':
			if (!key) return { error: 'Brak klucza' };

			switch (type) {
				case 'string':
					if (!value) return { error: 'Brak wartości' };

					await client.set(key, JSON.stringify(value));
					if (ttl && ttl > 0) await client.expire(key, ttl);

					return { message: 'Klucz string ustawiony' };

				case 'hash':
					if (!value || typeof value !== 'object')
						return { error: 'Brak wartości dla hash lub niepoprawny typ' };

					const stringifiedHash = Object.fromEntries(
						Object.entries(value).map(([k, v]) => [k, JSON.stringify(v)])
					);
					await client.hSet(key, stringifiedHash);
					if (ttl && ttl > 0) await client.expire(key, ttl);

					return { message: 'Hash ustawiony' };

				case 'list':
					if (!Array.isArray(value)) return { error: 'Wartość musi być tablicą' };

					const stringifiedList = value.map(item => JSON.stringify(item));
					await client.rPush(key, stringifiedList);
					if (ttl && ttl > 0) await client.expire(key, ttl);

					return { message: 'Lista ustawiona' };

				case 'set':
					if (!Array.isArray(value)) return { error: 'Wartość musi być tablicą' };

					const stringifiedSet = value.map(item => JSON.stringify(item));
					await client.sAdd(key, stringifiedSet);
					if (ttl && ttl > 0) await client.expire(key, ttl);

					return { message: 'Set ustawiony' };

				// case 'zset':
				//   if (
				//     !Array.isArray(value) ||
				//     !value.every((item: any) => item.score !== undefined && item.value !== undefined)
				//   )
				//     return { error: 'Wartość musi być tablicą obiektów z polem "score" i "value"' };
				//   for (const item of value) {
				//     await client.zAdd(key, { score: item.score, value: item.value });
				//   }
				//   console.log('SET (zset)', key, value);
				//   return { message: 'Sorted Set ustawiony' };

				default:
					return { error: 'Nieobsługiwany typ danych' };
			}

		case 'DELETE':
			if (!key) return { error: 'Brak klucza' };

			if (key === 'FLUSHALL') {
				await client.flushAll();
				return { message: 'Wszystkie klucze zostały usunięte' };
			}

			await client.del(key);
			return { message: 'Klucz usunięty' };

		default:
			return { error: 'Nieobsługiwana metoda' };
	}
};

serve({
	port: 5001,
	async fetch(req: Request) {
		const url = new URL(req.url);
		const method = req.method;

		const headers: { [key: string]: string } = {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type'
		};

		if (method === 'OPTIONS') {
			return new Response('', { status: 200, headers });
		}

		if (url.pathname === '/api/redis') {
			try {
				const body = method !== 'GET' && method !== 'DELETE' ? await req.json() : null;
				const key =
					method === 'GET' || method === 'DELETE' ? url.searchParams.get('key') : body?.key;
				const value = body?.value;
				const ttl = body?.ttl ? parseInt(body.ttl, 10) : 0;
				const type = body?.type;

				const result = await handleRedisAction(method, key, value, ttl, type);

				if (result?.error)
					return new Response(JSON.stringify({ error: result.error }), { status: 400, headers });

				return new Response(JSON.stringify(result), { status: 200, headers });
			} catch (error) {
				return new Response(
					JSON.stringify({ error: error instanceof Error ? error.message : 'Nieznany błąd' }),
					{ status: 400, headers }
				);
			}
		} else if (url.pathname === '/api/health') {
			const health = await healthCheck();
			return new Response(JSON.stringify(health), {
				status: health.status === 'OK' ? 200 : 500,
				headers
			});
		}

		return new Response(JSON.stringify({ error: 'Nieobsługiwany adres URL' }), {
			status: 404,
			headers
		});
	}
});

console.log('Redis API uruchomiony na porcie 5001');
