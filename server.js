// Library
const express = require('express');

// Scrap Commerce
const Magento = require('./lib/magento');

// Usage
const app = express();

// Port to use
const port = 5000;
app.use(express.json());

app.post('/api/magento', async (req, res) => {
	if (!req.body.website) {
		res.status(402).json({ status: 402, message: "Are you fucking kidding me?" });
	}
	
	Magento.main(req.body.website).then(result => {
		if (!result.status) {
			res.status(200).json({ status: 200, request: req.body.website, response: result });
		} else {
			res.status(200).json({ status: 400, request: req.body.website, message: result.message });
		}
	}).catch(error => {
		res.status(200).json({ status: 400, request: req.body.website, message: 'Something fucked up.' });
	});
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