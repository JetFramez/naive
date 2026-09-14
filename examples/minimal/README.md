# minimal

The smallest useful naive app. One router, one validated body, one thrown error, wired through `createApp`.

```sh
pnpm --filter minimal start
curl http://localhost:3000/orders/1
curl -X POST http://localhost:3000/orders -H 'content-type: application/json' -d '{"total": 10}'
curl http://localhost:3000/orders/999   # 404, unified error shape
```
