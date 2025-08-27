# @bricco/mongo-wrapper

A powerful MongoDB wrapper for Next.js applications that simplifies database operations with built-in caching, BSON simplification, and comprehensive debugging capabilities.

## Features

- **Next.js Integration**: Built-in support for Next.js caching with `unstable_cache`
- **BSON Simplification**: Automatic conversion of ObjectIds to strings for easier handling
- **Debug Logging**: Comprehensive development logging with performance metrics
- **TypeScript Support**: Full TypeScript support with proper type inference
- **Flexible Caching**: Configurable caching strategies with tag-based invalidation
- **Mutation Hooks**: Customizable hooks for insert/update operations
- **Performance Monitoring**: Built-in timing and error tracking

## Key Benefits

- **Simplified Data Handling**: ObjectIds are automatically converted to strings, eliminating the need for manual BSON handling
- **Smart Caching**: Leverage Next.js cache with automatic invalidation on mutations
- **Development Friendly**: Rich debug logging shows query performance and parameters
- **Production Ready**: Optimized for both development and production environments
- **Test Compatible**: Easy integration with in-memory MongoDB for testing

## Install

```shell
yarn add @bricco/mongo-wrapper
```

## Example

```js
import { MongoClient } from 'mongodb'
import createDb from '@bricco/mongo-wrapper';
import { unstable_cache as cache } from 'next/cache';

// Important! MongoClient must be a singleton and only instantiated once.
// Never do client.close() manually, or no new connections will be opened.
const client = new MongoClient('mongodb://localhost:27017', {
	maxIdleTimeMS: 60000, // Set to the same as maxDuration 
	maxPoolSize: 10, // the default is 100, 10 is better suited for serverless
	retryWrites: true,
	serverSelectionTimeoutMS: 5000,
	socketTimeoutMS: 45000,
	w: 'majority',
});

const db = createDb({
	database: 'myDatabase',
	client,
	cache: cache,
})

const car = await db('mycollection').findOne({ type: 'car' })
// => { _id: "61df...", type: "car", ...etc }

// To disable cache
const car = await db('mycollection').findOne({ type: 'car' }, { cache: false })
// => { _id: "61df...", type: "car", ...etc }

// To manually revalidate the cache
revalidateTags('mycollection')
```
