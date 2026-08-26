import { Router } from "express";
import { authenticate, requirePerm } from "../middleware/auth";
import * as ctrl from "../controllers/approval.controller";

const router = Router();
router.use(authenticate);

router.get("/", requirePerm("system:approval"), ctrl.list);
router.get("/:type", requirePerm("system:approval"), ctrl.getByType);
router.post("/", requirePerm("system:approval:edit"), ctrl.save);
router.delete("/:type", requirePerm("system:approval:edit"), ctrl.remove);

export default router;
