import { Router, type IRouter } from "express";
import healthRouter from "./health";
import trimRouter from "./trim";

const router: IRouter = Router();

router.use(healthRouter);
router.use(trimRouter);

export default router;
