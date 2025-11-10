import { createClient, getAllClients } from "../controllers/client.controller.js";

import { Router } from "express";
const router = Router();

// route to create a new client

/**
 * @openapi
 * /api/clients:
 *   post:
 *     tags:
 *       - Clients
 *     summary: Create a new client
 *     description: Create a new client with the provided details
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientName
 *               - clientEmail
 *               - industry
 *               - monthlyBudget
 *             properties:
 *               clientName:
 *                 type: string
 *                 example: Milton Gaire
 *               clientEmail:
 *                 type: string
 *                 example: milton@example.com
 *               industry:
 *                 type: string
 *                 example: marketing
 *               monthlyBudget:
 *                 type: number
 *                 example: 5000
 *     responses:
 *       201:
 *         description: Client created successfully
 */
router.post("/", createClient);


// route to get all clients




/**
 * @openapi
 * /api/clients:
 *   get:
 *     tags: [Clients]
 *     summary: Get all clients
 *     responses:
 *       200:
 *         description: Successful fetch
 */

router.get('/', getAllClients);

export default router;
