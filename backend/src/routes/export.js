import { Router } from "express";

const router = Router();

router.get("/iep-pdf", async (_req, res, next) => {
  try {
    return res.json({
      export_id: "exp_iep_881",
      type: "iep_pdf",
      status: "queued",
      requested_at: new Date().toISOString(),
      estimated_ready_seconds: 4,
      download_url: null,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
