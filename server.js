// Library
const express = require('express');

// Scrap Commerce
const Magento = require('./lib/magento');
const Woocommerce = require('./lib/woocommerce');
const Rapid = require('./lib/rapid');
const Helper = require('./lib/helper');

// Usage
const app = express();

// Port to use
const port = 5000;
app.use(express.json());

app.post('/api/commerce', async (req, res, next) => {
	if (!req.body.website) {
		res.status(402).json({ status: 402, message: 'Website field is missing.' });
	}

	try {
		let handler;
		let commerce_type;
		const url = await Helper.url_base(req.body.website);

		if (url.type === 1) {
			commerce_type = 'Woocommerce';
			handler = req.body.rapid ? Rapid.woocommerce(url.base) : Woocommerce.main(url.base);
		} else if (url.type === 2) {
			commerce_type = 'Magento';
			handler = req.body.rapid ? Rapid.magento(url.base) : Magento.main(url.base);
		} else {
			return res.status(500).json({ status: 500, request: req.body.website, message: "Website unresponsive or invalid." });
		}

		handler.then(result => {
			if (!result.status) {
				return res.status(200).json({ status: 200, request: req.body.website, type: commerce_type, response: result });
			}
			return res.status(400).json({ status: 400, request: req.body.website, message: result.message });
		}).catch(error => {
			return res.status(500).json({ status: 500, request: req.body.website, message: "An error has occurred, check your logs and report to @chronogical." });
		});
	} catch (error) {
		next(error);
	}
});

app.get('/', (req, res) => {
    res.status(200).json({ status: 200, message: 'Heartbeat complied.' });
});

app.use((err, req, res, next) => {
	console.error(err.stack);
    res.status(500).json({
        message: 'Something went wrong. Please try again later.'
    });
});

// Server
app.listen(port, () => {
    console.log(`Server is running on ${port}`);
});
