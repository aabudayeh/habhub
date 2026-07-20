import { friendlyDate } from '@/src/domain/date';
import { leaderboardRows } from '@/src/domain/leaderboard';
import { sharedMetricResult } from '@/src/domain/metrics';
import { AppState, MetricDefinition } from '@/src/types';

export type ComparisonStats={bestDay:string;bestScore:number;daysWon:number;longestWinStreak:number;eligibleDays:number};

export function comparisonStats(state:AppState,subjectId:string,viewerId:string,dates:string[],metrics:MetricDefinition[]):ComparisonStats{
  const ordered=[...dates].sort();let bestDate='';let bestScore=-1;let daysWon=0;let longest=0;let current=0;let eligibleDays=0;
  for(const date of ordered){
    const hasData=metrics.some((metric)=>metric.dataType==='calculated'||state.entries.some((entry)=>entry.metricId===metric.id&&entry.userId===subjectId&&entry.localDate===date));
    if(!hasData){current=0;continue;}
    eligibleDays+=1;
    const rows=leaderboardRows(state,metrics,[date],viewerId,metrics.length===0);const subject=rows.find((row)=>row.member.id===subjectId);const viewer=rows.find((row)=>row.member.id===viewerId);const score=subject?.score??0;
    if(score>bestScore){bestScore=score;bestDate=date;}
    const won=subjectId===viewerId?rows[0]?.member.id===subjectId:Boolean(subject&&viewer&&subject.score>viewer.score);
    if(won){daysWon+=1;current+=1;longest=Math.max(longest,current);}else current=0;
  }
  return{bestDay:bestDate?friendlyDate(bestDate):'—',bestScore:Math.max(0,bestScore),daysWon,longestWinStreak:longest,eligibleDays};
}

export type HeadToHeadStats = {
  subjectBest: { value: number; date: string };
  viewerBest: { value: number; date: string };
  subjectWins: number;
  viewerWins: number;
  ties: number;
  subjectLongestStreak: number;
  viewerLongestStreak: number;
  eligibleDays: number;
};

export function supportsHeadToHead(metric: MetricDefinition): boolean {
  return metric.dataType === 'number'
    && metric.rankingDirection === 'higher'
    && metric.goal.kind === 'at_least'
    && metric.aggregation !== 'latest';
}

export function metricHeadToHeadStats(
  state: AppState,
  metric: MetricDefinition,
  subjectId: string,
  viewerId: string,
  dates: string[],
): HeadToHeadStats | undefined {
  if (!supportsHeadToHead(metric) || subjectId === viewerId) return undefined;
  let subjectBest = { value: Number.NEGATIVE_INFINITY, date: '' };
  let viewerBest = { value: Number.NEGATIVE_INFINITY, date: '' };
  let subjectWins = 0;
  let viewerWins = 0;
  let ties = 0;
  let subjectRun = 0;
  let viewerRun = 0;
  let subjectLongestStreak = 0;
  let viewerLongestStreak = 0;
  let eligibleDays = 0;

  for (const date of [...dates].sort()) {
    const subjectHasEntry = state.entries.some((entry) => entry.metricId === metric.id && entry.userId === subjectId && entry.localDate === date);
    const viewerHasEntry = state.entries.some((entry) => entry.metricId === metric.id && entry.userId === viewerId && entry.localDate === date);
    if (!subjectHasEntry || !viewerHasEntry) continue;
    const subject = sharedMetricResult(state, metric, subjectId, viewerId, date);
    const viewer = sharedMetricResult(state, metric, viewerId, viewerId, date);
    if (subject.mode !== 'exact' || viewer.mode !== 'exact') continue;
    eligibleDays += 1;
    if (subject.value > subjectBest.value) subjectBest = { value: subject.value, date };
    if (viewer.value > viewerBest.value) viewerBest = { value: viewer.value, date };
    if (subject.value > viewer.value) {
      subjectWins += 1;
      subjectRun += 1;
      viewerRun = 0;
      subjectLongestStreak = Math.max(subjectLongestStreak, subjectRun);
    } else if (viewer.value > subject.value) {
      viewerWins += 1;
      viewerRun += 1;
      subjectRun = 0;
      viewerLongestStreak = Math.max(viewerLongestStreak, viewerRun);
    } else {
      ties += 1;
      subjectRun = 0;
      viewerRun = 0;
    }
  }
  if (!eligibleDays) return undefined;
  return { subjectBest, viewerBest, subjectWins, viewerWins, ties, subjectLongestStreak, viewerLongestStreak, eligibleDays };
}
