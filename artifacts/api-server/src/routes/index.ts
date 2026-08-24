import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ownerRouter from "./owner";
import storageRouter from "./storage";
import studioRouter from "./studio";
import commerceRouter from "./commerce";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ownerRouter);
router.use(storageRouter);
router.use(studioRouter);
router.use(commerceRouter);

export default router;
