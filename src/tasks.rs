//! Task lifecycle finite-state machine (MODEL.md §2.2).
//!
//! The atomic unit of work is a [`Task`]. Its five states plus the transitions
//! T1–T9 are the reproducibility contract's backbone; every transition is a
//! method here so the step loops in [`crate::mechanics`] read as the §5
//! algorithm and every transition is unit-tested in isolation. The team-only
//! `review` state (T6r/T6d) and the M20 review-clearance queue live here too,
//! ready for P7a's team loop while already exercised by the FSM tests.

/// Task class (§2.2). Drives effort draw and the routine/novel AI split.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskClass {
    Routine,
    Complex,
    Novel,
}

/// Team-sim stakes (§2.2). Ignored by the org sim.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stakes {
    Low,
    High,
}

/// The five FSM states plus `Done` (§2.2). `Queued(l)` is 1-indexed over the
/// `L` ownership layers; `Review` is team-sim only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskState {
    Queued(u32),
    InProgress,
    Review,
    Blocked,
    Done,
}

#[derive(Clone, Debug)]
pub struct Task {
    /// Global arrival order — the FIFO tiebreaker after arrival/completion step.
    pub id: u64,
    pub arrival_step: u32,
    pub class: TaskClass,
    pub stakes: Stakes,
    pub effort: f64,
    pub progress: f64,
    pub state: TaskState,
    /// Days of service left at the current layer (M6); decremented per step.
    pub service_remaining: f64,
    pub override_count: u32,
    /// Steps left in a brittleness block / recovery window (T2 → T8, M10).
    pub block_remaining: u32,
    /// Step at which execution completed and the task entered `review` (T6r) —
    /// the FIFO key for M20 clearance.
    pub completion_step: u32,
    /// Review dwell left before the task is eligible to clear (T6d).
    pub review_dwell_remaining: f64,
}

impl Task {
    /// T1: a task arrives into `queued(1)` with a fresh service draw.
    pub fn arriving(
        id: u64,
        arrival_step: u32,
        class: TaskClass,
        stakes: Stakes,
        effort: f64,
        service: f64,
    ) -> Self {
        Task {
            id,
            arrival_step,
            class,
            stakes,
            effort,
            progress: 0.0,
            state: TaskState::Queued(1),
            service_remaining: service,
            override_count: 0,
            block_remaining: 0,
            completion_step: 0,
            review_dwell_remaining: 0.0,
        }
    }

    /// T2: a brittleness event fires on a novel arrival — the task starts
    /// `blocked` for the recovery window `duration` (M9/M10/M11).
    pub fn arriving_blocked(
        id: u64,
        arrival_step: u32,
        effort: f64,
        stakes: Stakes,
        duration: u32,
    ) -> Self {
        Task {
            id,
            arrival_step,
            class: TaskClass::Novel,
            stakes,
            effort,
            progress: 0.0,
            state: TaskState::Blocked,
            service_remaining: 0.0,
            override_count: 0,
            block_remaining: duration,
            completion_step: 0,
            review_dwell_remaining: 0.0,
        }
    }

    /// Is the task in the WIP set (§2.2: queued + inProgress + blocked)? Tasks in
    /// `review` are past execution and excluded.
    pub fn is_wip(&self) -> bool {
        matches!(
            self.state,
            TaskState::Queued(_) | TaskState::InProgress | TaskState::Blocked
        )
    }

    /// T3: advance from `queued(l)` to `queued(l+1)` with a fresh service draw.
    pub fn advance_layer(&mut self, new_service: f64) {
        if let TaskState::Queued(l) = self.state {
            self.state = TaskState::Queued(l + 1);
            self.service_remaining = new_service;
        }
    }

    /// T4: leave the final layer into `inProgress`. Returns the first-pass
    /// decision-latency sample (task age) when `overrideCount == 0`, else `None`.
    pub fn to_in_progress(&mut self, step: u32) -> Option<f64> {
        self.state = TaskState::InProgress;
        if self.override_count == 0 {
            Some(f64::from(step - self.arrival_step))
        } else {
            None
        }
    }

    /// T5: allocate execution points.
    pub fn allocate(&mut self, points: f64) {
        self.progress += points;
    }

    pub fn is_complete(&self) -> bool {
        self.progress >= self.effort
    }

    /// T6: complete straight to `done` (org sim, or team sim with review
    /// uncovered).
    pub fn complete(&mut self) {
        self.state = TaskState::Done;
    }

    /// T6r: enter the team-sim `review` dwell on execution completion.
    pub fn to_review(&mut self, step: u32, dwell: f64) {
        self.state = TaskState::Review;
        self.completion_step = step;
        self.review_dwell_remaining = dwell;
    }

    /// T6d: clear a dwell-elapsed review to `done`.
    pub fn clear_review(&mut self) {
        self.state = TaskState::Done;
    }

    /// T7: an override sends the task back to `queued(1)`, keeping
    /// `wipResetFraction · max(0, 1 − dropMean)` of its progress (M8/M19).
    ///
    /// Draws **no** fresh service — the override event consumes exactly its M8
    /// Bernoulli plus the one M19 attribution uniform and nothing else (the
    /// one-uniform-per-event RNG-parity contract). The task re-enters layer 1
    /// ready, then pays fresh service draws re-traversing layers 2..L via T3.
    pub fn override_reset(&mut self, kept_fraction: f64) {
        self.state = TaskState::Queued(1);
        self.progress *= kept_fraction;
        self.override_count += 1;
        self.service_remaining = 0.0;
    }

    /// T8: the recovery window elapsed; `blocked → queued(1)` with a fresh draw.
    pub fn unblock(&mut self, new_service: f64) {
        self.state = TaskState::Queued(1);
        self.service_remaining = new_service;
    }
}

/// M20 review clearance (team sim, §5.2 step 7). Clears dwell-elapsed tasks in
/// `review` to `done` in FIFO order (completion step, then id), up to the
/// per-step budget from a use-it-or-lose-it fractional accumulator that banks at
/// most one whole clearance. `capacity == None` is unbounded (v1 behavior: every
/// dwell-elapsed task clears). Returns the ids cleared this step, in clear order.
///
/// The dwell decrement happens in the caller (once per step); this consumes the
/// already-elapsed set. Pure and deterministic — it adds no RNG draw.
pub fn clear_reviews(tasks: &mut [Task], capacity: Option<f64>, acc: &mut f64) -> Vec<u64> {
    let mut ready: Vec<usize> = tasks
        .iter()
        .enumerate()
        .filter(|(_, t)| t.state == TaskState::Review && t.review_dwell_remaining <= 0.0)
        .map(|(i, _)| i)
        .collect();
    // FIFO by completion step, then task id.
    ready.sort_by(|&a, &b| {
        tasks[a]
            .completion_step
            .cmp(&tasks[b].completion_step)
            .then(tasks[a].id.cmp(&tasks[b].id))
    });

    let clear_count = match capacity {
        None => ready.len(),
        Some(cap) => {
            *acc += cap;
            let n = acc.floor().max(0.0) as usize;
            n.min(ready.len())
        }
    };

    let mut cleared = Vec::with_capacity(clear_count);
    for &idx in ready.iter().take(clear_count) {
        tasks[idx].clear_review();
        cleared.push(tasks[idx].id);
    }
    if capacity.is_some() {
        // Bank at most one whole clearance between steps (M6-style, M20).
        *acc = (*acc - clear_count as f64).min(1.0);
    }
    cleared
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Task {
        Task::arriving(0, 0, TaskClass::Routine, Stakes::Low, 3.0, 2.5)
    }

    #[test]
    fn t1_arrival_enters_queued_layer_one() {
        let t = sample();
        assert_eq!(t.state, TaskState::Queued(1));
        assert_eq!(t.service_remaining, 2.5);
        assert!(t.is_wip());
    }

    #[test]
    fn t2_brittle_arrival_starts_blocked() {
        let t = Task::arriving_blocked(1, 4, 8.0, Stakes::High, 4);
        assert_eq!(t.state, TaskState::Blocked);
        assert_eq!(t.block_remaining, 4);
        assert!(t.is_wip());
    }

    #[test]
    fn t3_advances_layers_with_fresh_service() {
        let mut t = sample();
        t.advance_layer(3.0);
        assert_eq!(t.state, TaskState::Queued(2));
        assert_eq!(t.service_remaining, 3.0);
    }

    #[test]
    fn t4_records_first_pass_latency_but_not_overridden_repassage() {
        let mut t = sample();
        t.arrival_step = 2;
        assert_eq!(t.to_in_progress(9), Some(7.0));
        assert_eq!(t.state, TaskState::InProgress);

        let mut o = sample();
        o.override_count = 1;
        assert_eq!(
            o.to_in_progress(9),
            None,
            "overridden re-passage is not sampled"
        );
    }

    #[test]
    fn t5_t6_execution_and_completion() {
        let mut t = sample();
        t.state = TaskState::InProgress;
        t.allocate(2.0);
        assert!(!t.is_complete());
        t.allocate(2.0);
        assert!(t.is_complete());
        t.complete();
        assert_eq!(t.state, TaskState::Done);
    }

    #[test]
    fn t6r_t6d_review_path() {
        let mut t = sample();
        t.state = TaskState::InProgress;
        t.to_review(10, 1.0);
        assert_eq!(t.state, TaskState::Review);
        assert!(!t.is_wip(), "review is excluded from WIP");
        assert_eq!(t.completion_step, 10);
        t.clear_review();
        assert_eq!(t.state, TaskState::Done);
    }

    #[test]
    fn t7_override_resets_progress_and_returns_to_layer_one() {
        let mut t = sample();
        t.state = TaskState::InProgress;
        t.progress = 2.0;
        t.override_reset(0.5);
        assert_eq!(t.state, TaskState::Queued(1));
        assert_eq!(t.progress, 1.0);
        assert_eq!(t.override_count, 1);
        assert_eq!(t.service_remaining, 0.0, "T7 draws no service");
    }

    #[test]
    fn t8_unblock_returns_to_queue() {
        let mut t = Task::arriving_blocked(1, 0, 8.0, Stakes::Low, 3);
        t.unblock(2.5);
        assert_eq!(t.state, TaskState::Queued(1));
    }

    #[test]
    fn m20_unbounded_clears_all_dwell_elapsed_in_fifo_order() {
        let mut tasks = vec![review_ready(2, 5), review_ready(1, 6), review_ready(0, 5)];
        let mut acc = 0.0;
        let cleared = clear_reviews(&mut tasks, None, &mut acc);
        // FIFO: completion step 5 (id 0, id 2), then step 6 (id 1).
        assert_eq!(cleared, vec![0, 2, 1]);
        assert!(tasks.iter().all(|t| t.state == TaskState::Done));
    }

    #[test]
    fn m20_fractional_capacity_uses_use_it_or_lose_it_accumulator() {
        // Capacity 0.5 clears one review every two steps.
        let mut acc = 0.0;
        let mut a = vec![review_ready(0, 0), review_ready(1, 0)];
        assert_eq!(
            clear_reviews(&mut a, Some(0.5), &mut acc).len(),
            0,
            "step 1: 0.5 banked"
        );
        assert_eq!(
            clear_reviews(&mut a, Some(0.5), &mut acc).len(),
            1,
            "step 2: 1.0 clears one"
        );
    }

    #[test]
    fn m20_capacity_below_arrival_leaves_a_backlog() {
        let mut acc = 0.0;
        let mut tasks: Vec<Task> = (0..5).map(|i| review_ready(i, 0)).collect();
        let cleared = clear_reviews(&mut tasks, Some(2.0), &mut acc);
        assert_eq!(cleared.len(), 2);
        assert_eq!(
            tasks
                .iter()
                .filter(|t| t.state == TaskState::Review)
                .count(),
            3,
            "the surplus stays queued for review"
        );
    }

    fn review_ready(id: u64, completion_step: u32) -> Task {
        let mut t = Task::arriving(id, 0, TaskClass::Routine, Stakes::Low, 1.0, 0.0);
        t.state = TaskState::Review;
        t.completion_step = completion_step;
        t.review_dwell_remaining = 0.0;
        t
    }
}
