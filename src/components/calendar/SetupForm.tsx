'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { MOVABLE_HOLIDAY_KEYS, STANDARD_EXAM_KEYS, GRADE12_EXAM_KEY } from '@/lib/calendar'
import type { AcademicYear, Semester, HolidayOccurrence, ExamInstance, StudentReturnDay } from '@/lib/calendar'

interface Props {
  yearId: string
  year: AcademicYear
  semesters: Semester[]
  holidays: HolidayOccurrence[]
  exams: ExamInstance[]
  studentReturn: StudentReturnDay | null
}

async function post(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!json.success) throw new Error(json.error.message)
  return json.data
}

export function SetupForm({ yearId, year, semesters, holidays, exams, studentReturn }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<Record<string, string>>({})

  async function run(key: string, fn: () => Promise<unknown>) {
    setStatus((s) => ({ ...s, [key]: 'Saving…' }))
    try {
      await fn()
      setStatus((s) => ({ ...s, [key]: 'Saved.' }))
      router.refresh()
    } catch (err) {
      setStatus((s) => ({ ...s, [key]: err instanceof Error ? err.message : 'Failed.' }))
    }
  }

  const s1 = semesters.find((s) => s.order === 1)
  const s2 = semesters.find((s) => s.order === 2)

  return (
    <div className="space-y-6">
      <Panel title="1. Year boundary">
        <p className="mb-3 text-sm text-muted-foreground">
          Defaults to Meskerem 5 → Sene 30. Replace with the real Ministry-plan dates once available — this is not a
          permanent official date.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            void run('boundary', () =>
              post(`/api/v1/academic-years/${yearId}`, 'PATCH', {
                startDate: form.get('startDate'),
                endDate: form.get('endDate'),
              }),
            )
          }}
        >
          <Field label="Start date" name="startDate" type="date" defaultValue={year.startDate} />
          <Field label="End date" name="endDate" type="date" defaultValue={year.endDate} />
          <Button type="submit" level="secondary">
            Save boundary
          </Button>
          <Status text={status.boundary} />
        </form>
      </Panel>

      <Panel title="2. Semesters">
        <div className="space-y-4">
          {[1, 2].map((order) => {
            const sem = order === 1 ? s1 : s2
            return (
              <form
                key={order}
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  const form = new FormData(e.currentTarget)
                  void run(`sem${order}`, () =>
                    post(`/api/v1/academic-years/${yearId}/semesters/${order}`, 'PATCH', {
                      startDate: form.get('startDate') || null,
                      endDate: form.get('endDate') || null,
                    }),
                  )
                }}
              >
                <span className="w-20 text-sm font-medium text-foreground">Semester {order}</span>
                <Field label="Start date" name="startDate" type="date" defaultValue={sem?.startDate ?? ''} />
                <Field label="End date" name="endDate" type="date" defaultValue={sem?.endDate ?? ''} />
                <Button type="submit" level="secondary">
                  Save
                </Button>
                <Status text={status[`sem${order}`]} />
              </form>
            )
          })}
        </div>
      </Panel>

      <Panel title="3. Holidays">
        <div className="space-y-4">
          <div>
            <Button
              level="secondary"
              onClick={() => void run('fixed', () => post(`/api/v1/academic-years/${yearId}/holidays`, 'POST', { action: 'seed_fixed' }))}
            >
              Propose the five fixed holidays
            </Button>
            <Status text={status.fixed} />
          </div>
          <ul className="divide-y divide-border text-sm">
            {holidays
              .filter((h) => h.source === 'AUTO_PROPOSED')
              .map((h) => (
                <li key={h.holidayTypeKey} className="flex items-center justify-between py-1.5">
                  <span>{h.holidayTypeKey}</span>
                  <span className="tabular-dates text-muted-foreground">
                    {h.date} · {h.closesSchool ? 'closes school' : 'does not close school'}
                  </span>
                </li>
              ))}
          </ul>

          <div className="border-t border-border pt-3">
            <p className="mb-2 text-sm text-muted-foreground">
              Movable holidays — enter the confirmed date from this year&apos;s Ministry plan. Never calculated.
            </p>
            {MOVABLE_HOLIDAY_KEYS.map((key) => {
              const existing = holidays.find((h) => h.holidayTypeKey === key)
              return (
                <form
                  key={key}
                  className="mb-2 flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const form = new FormData(e.currentTarget)
                    void run(key, () =>
                      post(`/api/v1/academic-years/${yearId}/holidays`, 'POST', {
                        action: 'enter_movable',
                        holidayTypeKey: key,
                        date: form.get('date'),
                        closesSchool: true,
                      }),
                    )
                  }}
                >
                  <span className="w-24 text-sm">{key}</span>
                  <Field label="Date" name="date" type="date" defaultValue={existing?.date ?? ''} />
                  <Button type="submit" level="secondary">
                    Save
                  </Button>
                  <Status text={status[key]} />
                </form>
              )
            })}
          </div>
        </div>
      </Panel>

      <Panel title="4. Exams">
        <div className="space-y-2">
          {[...STANDARD_EXAM_KEYS, GRADE12_EXAM_KEY].map((key) => {
            const existing = exams.find((e) => e.examTypeKey === key)
            return (
              <form
                key={key}
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  const form = new FormData(e.currentTarget)
                  void run(key, () =>
                    post(`/api/v1/academic-years/${yearId}/exams`, 'PUT', {
                      examTypeKey: key,
                      startDate: form.get('startDate'),
                      endDate: form.get('endDate'),
                    }),
                  )
                }}
              >
                <span className="w-40 text-sm">{key}</span>
                <Field label="Start" name="startDate" type="date" defaultValue={existing?.startDate ?? ''} />
                <Field label="End" name="endDate" type="date" defaultValue={existing?.endDate ?? ''} />
                <Button type="submit" level="secondary">
                  Save
                </Button>
                <Status text={status[key]} />
              </form>
            )
          })}
        </div>
      </Panel>

      <Panel title="5. Student Return / Orientation">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            void run('return', () =>
              post(`/api/v1/academic-years/${yearId}/student-return`, 'PUT', { date: form.get('date') }),
            )
          }}
        >
          <Field label="Date" name="date" type="date" defaultValue={studentReturn?.date ?? ''} />
          <Button type="submit" level="secondary">
            Save
          </Button>
          <Status text={status.return} />
        </form>
      </Panel>
    </div>
  )
}

function Field({
  label,
  name,
  type,
  defaultValue,
}: {
  label: string
  name: string
  type: string
  defaultValue: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  )
}

function Status({ text }: { text?: string }) {
  if (!text) return null
  return <span className="text-xs text-muted-foreground">{text}</span>
}
