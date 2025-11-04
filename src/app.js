import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import dotenv from 'dotenv';
import { swaggerServe, swaggerSetup } from "./config/swagger.js";




dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());


// Api docs ( swagger Ui)

app.use("/api-docs", swaggerServe, swaggerSetup);

// api routes
app.use('/api', routes);

// basic route check

app.get('/', (req, res) => {
  res.send('LRB Insights Backend is running');
});

export default app;