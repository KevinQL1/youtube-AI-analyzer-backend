import { query } from '#db/index';
import { getYouTubeReportingClient } from '#clients/youtubeReportingClient';

const REACH_REPORT_TYPE = 'channel_reach_basic_a1';

const parseCsvLine = (line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i += 1; }
        else if (char === '"') quoted = !quoted;
        else if (char === ',' && !quoted) { values.push(value); value = ''; }
        else value += char;
    }
    values.push(value);
    return values;
};

const parseCsv = (csv) => {
    const lines = String(csv).split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null]));
    });
};

export const listReportingJobs = async () => {
    const reporting = getYouTubeReportingClient();
    const response = await reporting.jobs.list({ includeSystemManaged: false, maxResults: 100 });
    return response.data.jobs || [];
};

export const ensureReachReportingJob = async () => {
    const reporting = getYouTubeReportingClient();
    const jobs = await listReportingJobs();
    const existing = jobs.find((job) => job.reportTypeId === REACH_REPORT_TYPE);
    if (existing) return existing;
    const response = await reporting.jobs.create({
        requestBody: {
            name: 'KEQUILO - impresiones y CTR',
            reportTypeId: REACH_REPORT_TYPE,
        },
    });
    return response.data;
};

export const syncReachReports = async () => {
    const reporting = getYouTubeReportingClient();
    const job = await ensureReachReportingJob();
    const reportsResponse = await reporting.jobs.reports.list({ jobId: job.id, maxResults: 100 });
    const reports = reportsResponse.data.reports || [];
    let importedRows = 0;

    for (const report of reports) {
        if (!report.downloadUrl) continue;
        const response = await fetch(report.downloadUrl, { headers: { 'Accept-Encoding': 'gzip' } });
        if (!response.ok) throw new Error(`No se pudo descargar el informe ${report.id}: HTTP ${response.status}`);
        const rows = parseCsv(await response.text());
        for (const row of rows) {
            await query(
                `INSERT INTO youtube_reach_daily (report_id, report_created_at, report_date, channel_id, video_id, impressions, impressions_ctr)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (report_id, video_id, report_date) DO UPDATE SET
                   report_created_at = EXCLUDED.report_created_at, impressions = EXCLUDED.impressions, impressions_ctr = EXCLUDED.impressions_ctr`,
                [report.id, report.createTime || null, row.date, row.channel_id, row.video_id,
                    Number(row.video_thumbnail_impressions || 0), Number(row.video_thumbnail_impressions_ctr || 0)]
            );
            importedRows += 1;
        }
    }
    return { job, reportsFound: reports.length, importedRows };
};

export const getReachStatus = async () => {
    const jobs = await listReportingJobs();
    const result = await query(`
        SELECT COUNT(*)::int AS rows, COALESCE(SUM(impressions), 0)::bigint AS impressions,
               ROUND(AVG(impressions_ctr)::numeric, 2) AS average_ctr,
               MAX(report_date) AS latest_report_date
        FROM youtube_reach_daily
    `);
    return { jobs, reach: result.rows[0] };
};
