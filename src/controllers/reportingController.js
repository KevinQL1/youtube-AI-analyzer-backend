import { ensureReachReportingJob, getReachStatus, syncReachReports } from '#services/reportingService';

export const setupReporting = async (req, res) => {
    try { return res.status(200).json({ success: true, job: await ensureReachReportingJob() }); }
    catch (error) { return res.status(500).json({ error: error.message }); }
};

export const syncReporting = async (req, res) => {
    try { return res.status(200).json({ success: true, ...(await syncReachReports()) }); }
    catch (error) { return res.status(500).json({ error: error.message }); }
};

export const reportingStatus = async (req, res) => {
    try { return res.status(200).json({ success: true, ...(await getReachStatus()) }); }
    catch (error) { return res.status(500).json({ error: error.message }); }
};
