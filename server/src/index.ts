import express, {Request,Response} from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import bodyParser from 'body-parser';
import { Server } from 'socket.io';


dotenv.config();
const app = express();

app.use(cors());
app.use(bodyParser.json());
const port = process.env.PORT || 9000;





app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});