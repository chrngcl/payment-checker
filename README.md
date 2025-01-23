
# payment-checker

Open-source web scraping tool to accurately extract payment sources.

## Features

- Magento

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

#### Usage for Magento

```
  POST /api/magento
```

| Parameter | Type     | Description                        |
| :-------- | :------- | :--------------------------------- |
| `website` | `string` | **Required**. Your magento website |
