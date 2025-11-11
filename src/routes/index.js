import { Router } from "express";
import healthRoutes from "./health.routes.js";
import googleAuthRoutes from "./googleAuth.routes.js";
import clientRoutes from "./client.routes.js";

const router = Router();

// group routes
router.use('/health', healthRoutes);

router.use("/google", googleAuthRoutes);

router.use('/clients', clientRoutes);


// api/google/


export default router;