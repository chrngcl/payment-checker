
# payment-checker

Open-source web scraping tool to accurately extract payment sources.

## Features

- Magento
- Woocommerce

## Installation

- Install [node.js](https://nodejs.org/en) to your system.
- Locate the project folder and run the command below using CMD to include the required libraries for the script.

```
  npm install
```

- While in its directory, run the server using the command below using CMD.

```
  node server.js
```
## API Reference

#### Usage for Magento and Woocommerce

```
  POST /api/magento
```
| Parameter | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `website` | `string` | **Required**. Your website query  |
```
  POST /api/woocommerce
```

| Parameter | Type     | Description                                     |
| :-------- | :------- | :---------------------------------------------- |
| `website` | `string`  | **Required**. Your website query               |
| `request` | `string`  | **Optional**. Set "rapid" for instant response |
| `item`    | `boolean` | **Optional**. Set "true" for item scraping     |
