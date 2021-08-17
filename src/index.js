require('dotenv').config();

const express = require('express');
const { join } = require('path');
const { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, createReadStream } = require('fs');
const multer = require('multer');
const { createCertificate } = require('pem');
const { createServer } = require('https');

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, join(__dirname, '../', 'files'));
	},
	filename: (req, file, cb) => {
		cb(null, file.originalname);
	},
});
const upload = multer({ storage });

const { ALREADY_CONNECTED_TO_PANEL, NOT_CONNECTED_TO_PANEL, NO_SUCH_FILE_OR_DIR, INVALID_BODY, SUCCESS } = require('../responses.json');

const {
	NODE_PORT,
} = process.env;

const port = NODE_PORT || 3001;
const dir = join(__dirname, '../', 'files');

if (!existsSync(join(__dirname, '../', 'keys'))) mkdirSync(join(__dirname, '../', 'keys'));
if (!existsSync(join(__dirname, '../', 'files'))) mkdirSync(join(__dirname, '../', 'files'));
let NODE_KEY = existsSync(join(__dirname, '../', 'keys/node.key')) ? readFileSync(join(__dirname, '../', 'keys/node.key'), 'utf8') : null;
let NODE_CA = existsSync(join(__dirname, '../', 'keys/ca.key')) ? readFileSync(join(__dirname, '../', 'keys/ca.key'), 'utf8') : null;
let NODE_CERT = existsSync(join(__dirname, '../', 'keys/node.cert')) ? readFileSync(join(__dirname, '../', 'keys/node.cert'), 'utf8') : null;
let PANEL_KEY = existsSync(join(__dirname, '../', 'keys/panel')) ? readFileSync(join(__dirname, '../', 'keys/panel'), 'utf8') : null;

if (!NODE_KEY || !NODE_CA || !NODE_CERT) {
	return createCertificate({ selfSigned: true }, (err, keys) => {
		if (err) throw err;

		NODE_KEY = keys.serviceKey;
		NODE_CA = keys.clientKey;
		NODE_CERT = keys.certificate;

		writeFileSync(join(__dirname, '../', 'keys/node.key'), NODE_KEY);
		writeFileSync(join(__dirname, '../', 'keys/ca.key'), NODE_CA);
		writeFileSync(join(__dirname, '../', 'keys/node.cert'), NODE_CERT);

		console.log(`To install this node, login on the panel, and enter the IP and port (${port}) of this server!`);
		console.log('The certificate can be found below! (copy the -----BEGIN CERTIFICATE----- and -----END CERTIFICATE----- too!)');
		console.log('');
		return console.log(NODE_CERT);
	});
}

const app = express();

app
	.use(express.json({ limit: '2000mb' }))
	.use(express.urlencoded({ limit: '2000mb', extended: true }))
	.set('views', join(__dirname, 'views'))
	.set('view engine', 'ejs')
	.post('/init', (req, res) => {
		const key = req.body.key;
		if (!key) return res.status(400).json({ message: INVALID_BODY, success: false });

		if (PANEL_KEY && PANEL_KEY !== key) return res.status(403).json({ message: ALREADY_CONNECTED_TO_PANEL, success: false });

		if (!PANEL_KEY) {
			PANEL_KEY = key;
			writeFileSync(join(__dirname, '../', 'keys/panel'), key);
		}

		return res.status(200).json({ message: SUCCESS, success: true });
	})
	.post('/files/delete', async (req, res) => {
		if (!PANEL_KEY) return res.status(400).json({ message: NOT_CONNECTED_TO_PANEL, success: false, reconnect: true });

		const id = req.body.id;
		if (!id) return res.status(400).json({ message: INVALID_BODY, success: false });
		if (!existsSync(`${dir}/${id}`)) return res.status(400).json({ message: NO_SUCH_FILE_OR_DIR, success: false });

		unlinkSync(`${dir}/${id}`);

		return res.status(200).json({ message: SUCCESS, success: true });
	})
	.post('/files/upload', upload.single('file'), async (req, res) => {
		if (!PANEL_KEY) return res.status(400).json({ message: NOT_CONNECTED_TO_PANEL, success: false, reconnect: true });
		const json = {
			message: SUCCESS,
			success: true,
		};
		return res.status(200).json(json);
	})
	.post('/files/download', async (req, res) => {
		if (!PANEL_KEY) return res.status(400).json({ message: NOT_CONNECTED_TO_PANEL, success: false, reconnect: true });

		const id = req.body.id;
		if (!id) return res.status(400).json({ message: INVALID_BODY, success: false });
		if (!existsSync(`${dir}/${id}`)) return res.status(400).json({ message: NO_SUCH_FILE_OR_DIR, success: false });

		return createReadStream(`${dir}/${id}`).pipe(res);
	})
	.get('*', (req, res) => {
		return res.status(200).send('Please use the panel!');
	});

createServer({ key: NODE_KEY, cert: NODE_CERT, ca: NODE_CA }, app).listen(port, (err) => {
	if (err) console.log(err);
	else console.log(`Server online on port ${port}`);
});