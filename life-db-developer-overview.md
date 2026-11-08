# Life DB — Developer Project Overview

## 1. Vision

**Life DB** is a personal "get your shit together" application.

The idea is to take the simplicity and therapeutic nature of a physical notebook and turn it into a structured, searchable database of a person's life.

The user should be able to track:

- What they do
- How they feel
- What they measure
- What they want to accomplish
- What happens in their life
- Eventually, where their money goes
- Eventually, what patterns exist across all of this

The long-term vision is a **Personal Life Operating System**, with an AI companion that can understand the user's history and answer questions about their life.

---

## 2. The Problem

The current inspiration is a physical notebook.

A typical month looks like:

```text
August

             1  2  3  4  5  6  7 ...
Exercise     ✓  ✓     ✓  ✓
Read         ✓     ✓  ✓
Meditate     ✓  ✓
Coffee       2  3  4  2
Sleep        7  6  5  8
```

Below the grid:

```text
Monthly Goals

- Read 3 books
- Learn a new recipe
- Finish project
```

The following pages are free-form journal entries.

This works, but:

- Drawing the grid every month takes time.
- Information is spread across pages.
- Finding old information is difficult.
- Connecting different pieces of information is difficult.
- There is no easy way to analyze months or years of history.
- Goals, habits, journal entries and measurements remain mostly disconnected.

The goal is **not** to eliminate the simplicity of the notebook.

The goal is to preserve it while making the information structured and useful.

---

# 3. Core Concept: Life DB

The application is fundamentally a personal database.

The major concepts are:

```text
                    LIFE DB
                       │
       ┌───────────────┼────────────────┐
       │               │                │
     Habits          Goals           Journal
       │               │                │
 Measurements      Milestones       Life Events
       │               │                │
       └───────────────┼────────────────┘
                       │
                  Categories
                    & Tags
```

Everything is associated with time.

The database should be able to represent years of a person's life without becoming difficult to query or maintain.

---

# 4. Habits

A habit represents a recurring behavior or activity.

Habits are **not limited to boolean values**.

Supported V1 types:

### Boolean

```text
Exercise → ✓
Meditate → ✓
```

### Number

```text
Coffee → 3 cups
Water → 2.5 L
```

### Duration

```text
Reading → 45 minutes
French study → 30 minutes
```

### Rating

```text
Mood → 8/10
Energy → 6/10
Stress → 7/10
```

A habit has configuration such as:

- Name
- Description
- Type
- Unit
- Target
- Frequency
- Category
- Priority
- Start date
- Optional end date
- Active/archived state

The actual daily values are stored separately as **habit entries**.

Conceptually:

```text
Habit
  "Coffee"
      │
      ├── Aug 12 → 2 cups
      ├── Aug 13 → 4 cups
      └── Aug 14 → 3 cups
```

The habit is the **definition**.

The habit entry is the **observation**.

---

# 5. Goals Are Different From Habits

This is an important product and data-model distinction.

A **goal** describes an intended outcome.

A **habit** describes something repeatedly done or measured.

Example:

```text
GOAL
Learn French
    │
    ├── Milestone: Complete A1
    ├── Milestone: Complete A2
    ├── Milestone: Hold 15-minute conversation
    │
    ├── Habit: Study French 30 min
    ├── Habit: Attend French class
    └── Habit: Practice speaking
```

Goals do not require habits.

Habits do not require goals.

The relationship between them is optional.

Other goals could be:

- Read 20 books this year
- Save $10,000
- Lose 10 kg
- Run a 10K
- Visit Japan

Goals can have:

- Description
- Category
- Priority
- Start date
- Target date
- Status
- Progress
- Milestones
- Optional linked habits

---

# 6. Journal

The journal is intentionally flexible.

There is **no requirement for one entry per day**.

A user can have:

- Multiple entries on one day
- Very short entries
- Very long entries
- Entries that mention multiple days
- Entries with tags
- Eventually images/files

The important distinction is between:

- `entry_date` — the date the entry is associated with
- `created_at` — when it was actually created
- `updated_at` — when it was last modified

The journal should feel like a digital notebook, not a rigid diary form.

---

# 7. Life Events

Life events represent significant occurrences that may be useful later for understanding changes over time.

Examples:

- Started a new job
- Moved
- Vacation
- Relationship event
- Major purchase
- Custom event

Events can have:

- Date
- Optional date range
- Name
- Description
- Category
- Tags

This feature should remain simple in V1.

---

# 8. Categories / Life Areas

Categories answer:

> **"What part of my life does this belong to?"**

Initial categories:

- Health
- Work
- Money
- Learning
- Relationships
- Home
- Personal
- Leisure

Users should eventually be able to create custom categories.

Categories are separate from priority.

Example:

```text
Exercise
Category: Health
Priority: High
```

---

# 9. Tags

Tags provide flexible organization across different parts of the Life DB.

Example:

```text
Journal entry:
"I was stressed about money today."

Tags:
- stress
- money
```

Tags may eventually apply to:

- Journal entries
- Habits
- Goals
- Life events
- Other entities

Tags should be designed carefully because they may become important to future search and AI analysis.

---

# 10. Daily View

The daily view replaces the experience of looking at a particular page/day in a notebook.

Example:

```text
August 14

HABITS
✓ Exercise
✓ Read
☐ Meditate

MEASUREMENTS
Sleep       7.2 h
Coffee      2 cups
Mood        8/10

GOALS
Learn French
  Study French ✓

JOURNAL
Today was...
```

The user should be able to enter most daily information in under a minute.

**Low-friction data entry is one of the core product principles.**

---

# 11. Monthly View

The monthly view is the digital replacement for the user's physical habit grid.

Example:

```text
                 AUGUST

             1  2  3  4  5  6  7 ...
Exercise      ✓  ✓     ✓  ✓
Reading       ✓     ✓  ✓
Meditate      ✓  ✓
Sleep         7  6  8  7
Coffee        2  3  4  2
Mood          8  6  7  9
```

The monthly view should support:

- Fast month navigation
- Editing values
- Boolean completion
- Numeric values
- Duration values
- Ratings
- Monthly averages/totals
- Links to the daily view

The UI should retain some of the visual simplicity and satisfaction of a physical notebook.

---

# 12. Basic Analytics

V1 should provide basic statistics without AI.

Examples:

### Boolean

```text
Exercise

August:
18 / 31 days
58%

July:
14 / 31 days
45%
```

### Number

```text
Sleep

Average: 6.8 h
Minimum: 4.9 h
Maximum: 8.4 h
```

### Rating

```text
Mood

Average: 7.2 / 10
```

### Duration

```text
Reading

Total: 12h 43m
Average: 24m/day
```

V1 should **not** build a sophisticated AI analytics engine.

Analytics should mostly be calculated from the source data.

---

# 13. Search

V1 should have basic global search.

Search should eventually cover:

- Journal entries
- Habits
- Goals
- Life events
- Tags
- Other textual data

Example:

```text
Search: "French"

Results:
- Goal: Learn French
- Habit: Study French
- Journal entry — August 14
- Journal entry — August 22
```

Future versions can replace/augment this with semantic AI search.

---

# 14. Data Export

The user should be able to take their data with them.

At minimum:

- JSON export
- CSV export where appropriate
- Journal export
- Full local database backup

This supports the overall philosophy:

> **Your life data belongs to you.**

---

# 15. V1 Architecture

V1 is intentionally **local-first and local-only**.

There is:

- No cloud backend
- No authentication requirement
- No Supabase dependency
- No AI
- No payment system
- No synchronization

The core architecture is:

```text
React + TypeScript
        │
        ▼
Data Access / Repository Layer
        │
        ▼
     SQLite
        │
        ▼
   Local Life DB
```

The UI should never be tightly coupled directly to SQLite queries.

Instead:

```text
UI
 ↓
Repository / Domain layer
 ↓
SQLite
```

This abstraction is important because V1.5 will introduce synchronization.

---

# 16. V1 Database

Conceptually:

```text
User / Local Profile
        │
        ├── Habits
        │      └── Habit Entries
        │
        ├── Goals
        │      └── Goal Milestones
        │
        ├── Journal Entries
        │
        ├── Life Events
        │
        ├── Categories
        │
        └── Tags
```

Entities that will eventually synchronize should use stable UUIDs.

Important timestamps should include:

```text
id
created_at
updated_at
```

A deletion strategy should be designed with future synchronization in mind, potentially using:

```text
deleted_at
```

The exact schema should be finalized separately through a dedicated backend/schema design process.

---

# 17. V1.5 — Cloud Sync

Once the local product is proven, add cloud synchronization.

The local SQLite database remains the primary local data source.

Conceptually:

```text
             DEVICE
        ┌───────────────┐
        │    SQLite     │
        │               │
        │   Life DB     │
        └───────┬───────┘
                │
             Sync Engine
                │
                ▼
        ┌───────────────┐
        │   Supabase    │
        │   PostgreSQL  │
        └───────────────┘
```

Premium users would get:

- Account
- Cloud backup
- Synchronization
- Multiple devices
- Cross-device access
- Recovery/restore
- Eventually web/mobile synchronization

The cloud should store structured PostgreSQL records rather than uploading the SQLite database as the normal synchronization mechanism.

SQLite remains useful locally.

---

# 18. Free vs Premium Concept

The initial business model can be:

### Free

**Local Life DB**

- Core features
- Local SQLite storage
- No account required
- Export/backup

### Premium

**Cloud Life DB**

- Everything in Free
- Cloud sync
- Automatic backup
- Multi-device access
- Eventually AI features

This avoids artificially restricting the core Life DB.

The user is paying for cloud infrastructure and additional services rather than paying simply to use the basic application.

---

# 19. Roadmap

```text
V1
Local Life DB
│
├── Habits
├── Measurements
├── Goals
├── Journal
├── Life Events
├── Categories
├── Tags
├── Daily View
├── Monthly View
├── Basic Analytics
├── Search
└── Export / Backup
        │
        ▼
V1.5
Cloud Sync
│
├── Authentication
├── Supabase
├── PostgreSQL
├── Sync Engine
├── Multi-device
└── Cloud Backup
        │
        ▼
V2
Advanced Analytics
│
├── Trends
├── Correlations
├── Goal ↔ Habit analysis
├── Long-term statistics
└── Life Timeline
        │
        ▼
V3
Money
│
├── Accounts
├── Transactions
├── Budgets
├── Income / Expenses
├── Savings
├── Debt
└── Net Worth
        │
        ▼
V4
AI Companion
```

The budgeting application is already largely developed separately and can be integrated as a future Life DB module rather than blocking V1.

---

# 20. Long-Term Vision

Eventually, the Life DB becomes a structured representation of the user's life.

```text
                    YOUR LIFE
                       │
       ┌───────────────┼────────────────┐
       │               │                │
     Health          Goals            Money
       │               │                │
     Habits          Journal         Spending
       │               │                │
       └───────────────┼────────────────┘
                       │
                    LIFE DB
                       │
                Analytics Layer
                       │
                       ▼
                 AI Companion
```

The AI would eventually be able to answer questions such as:

> "Why haven't I been sleeping well?"

> "What tends to make me stressed?"

> "What changed in my life over the last six months?"

> "Am I actually progressing toward my goals?"

> "Where is my money going?"

> "What habits seem to make my mood better?"

The AI should not just receive a journal entry and guess.

It should be able to reason over structured and unstructured historical data.

For example:

```text
Sleep
Exercise
Coffee
Mood
Journal
Goals
Money
Life Events
```

and identify meaningful relationships.

---

# 21. Product Philosophy

### Low friction

Tracking something should take seconds.

### Notebook-like

The product should preserve the simplicity and satisfaction of the physical notebook.

### Structured underneath

The user should not have to think about database structure.

### User-owned data

Users should be able to export and back up their data.

### Local-first

The core product should work without an internet connection.

### Incremental complexity

Start simple.

Add advanced analytics, cloud sync, money and AI only when the core Life DB is useful.

### AI is not the product

The AI is eventually an interface over the Life DB.

The Life DB itself is the foundation.

---

# 22. What We Are Building First

The immediate objective is **not** to build the entire vision.

The first objective is:

> **Build the best digital replacement for the user's physical Life notebook.**

The first technical milestone is therefore:

**Design and implement the local SQLite schema and data-access layer.**

Then build the V1 functionality on top of it.

The cloud, synchronization, budgeting integration and AI should come later.
