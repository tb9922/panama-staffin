import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  if (shaped.date instanceof Date) shaped.date = shaped.date.toISOString().slice(0, 10);
  if (shaped.reported_at instanceof Date) shaped.reported_at = shaped.reported_at.toISOString();
  delete shaped.home_id;
  delete shaped.created_at;
  return shaped;
}

export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM complaint_surveys WHERE home_id = $1 ORDER BY date DESC NULLS LAST',
    [homeId]
  );
  return rows.map(shapeRow);
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(s => s.id);

  for (const s of arr) {
    await conn.query(
      `INSERT INTO complaint_surveys (
         id, home_id, type, date, title, total_sent, responses,
         overall_satisfaction, area_scores, key_feedback, actions, conducted_by, reported_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (home_id, id) DO UPDATE SET
         type=$3,date=$4,title=$5,total_sent=$6,responses=$7,
         overall_satisfaction=$8,area_scores=$9,key_feedback=$10,
         actions=$11,conducted_by=$12,reported_at=$13`,
      [
        s.id, homeId, s.type || null, s.date || null, s.title || null,
        s.total_sent || null, s.responses || null, s.overall_satisfaction || null,
        JSON.stringify(s.area_scores || {}), s.key_feedback || null,
        s.actions || null, s.conducted_by || null, s.reported_at || null,
      ]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `DELETE FROM complaint_surveys WHERE home_id = $1 AND id != ALL($2::text[])`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query('DELETE FROM complaint_surveys WHERE home_id = $1', [homeId]);
  }
}
