## @bricco/mongo-wrapper

A simple wrapper to get a unified interface against the [MongoDB Data API](https://docs.atlas.mongodb.com/api/data-api/) and [MongoDB Node Driver](https://www.mongodb.com/docs/drivers/node/current/)

The wrapper is very useful if you want to use MongoDb in vercel edge runtime or benifit from the Nextjs built-in data cache. But still have the possibilty do run tests against a [In-Memory Storage Engine](https://www.mongodb.com/docs/manual/core/inmemory/) or use a local database with the node driver.

## Install

The usual ways:

```shell
yarn add @bricco/mongo-wrapper
```

## Example

```js
import createDb from '@bricco/mongo-wrapper'

const db = createDb({
	apiKey: 'XXXXXXXX',
	apiUrl: 'https://data.mongodb-api.com/app/data-abc123/endpoint/data/v1',
	dataSource: 'myCluser',
	database: 'myDatabase',
	connectionString: 'mongodb+srv://user:<PWD>@myCluser.apc123.mongodb.net',
})

const car = await db('mycollection').findOne({ type: 'car' })
// => { _id: "61df...", type: "car", ...etc }

const useNodeDriver = true;
const bike = await db('mycollection', useNodeDriver).findOne({ type: 'bike' })
// => { _id: "61df...", type: "bike", ...etc }
```
