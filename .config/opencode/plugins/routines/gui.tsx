import { createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { Command, Plugin, SettingsPage, usePlugin } from "@opencode/plugin/gui"

import { Routines, type RoutineView, type RunRecordView } from "./rpc"

const PAGE_ID = "routines"
const REFRESH_MS = 15_000
const RECENT_RUNS = 8
const SERVER = "sidecar"

function relative(time: number, now: number): string {
  const minutes = Math.round((time - now) / 60_000)
  const size = Math.abs(minutes)
  const amount = size < 60 ? `${size} min` : size < 48 * 60 ? `${Math.round(size / 60)} h` : `${Math.round(size / 1440)} d`
  if (size === 0) return "now"
  return minutes > 0 ? `in ${amount}` : `${amount} ago`
}

function when(time: number, now: number): string {
  const date = new Date(time).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  return `${date} (${relative(time, now)})`
}

function RoutinesPage() {
  const ctx = usePlugin()
  const ui = ctx.ui
  const [now, setNow] = createSignal(Date.now())
  const [busy, setBusy] = createSignal<string>()
  const [data, { refetch }] = createResource(() => ctx.client.rpc(Routines).list({}))

  const timer = setInterval(() => {
    setNow(Date.now())
    void refetch()
  }, REFRESH_MS)
  onCleanup(() => clearInterval(timer))

  const act = async (key: string, task: () => Promise<unknown>, success?: string) => {
    setBusy(key)
    try {
      await task()
      if (success) ctx.toast.show({ variant: "success", title: success })
    } catch (error) {
      ctx.toast.show({ variant: "error", title: "Routine action failed", description: (error as Error).message })
    } finally {
      setBusy(undefined)
      setNow(Date.now())
      void refetch()
    }
  }

  const openSession = (sessionID: string) => ctx.tabs.open({ server: SERVER, id: sessionID }, { focus: true })

  const runNow = (routine: RoutineView) =>
    act(`run:${routine.id}`, async () => {
      const { sessionID } = await ctx.client.rpc(Routines).run({ id: routine.id })
      ctx.toast.show({
        variant: "success",
        title: `Started ${routine.name}`,
        actions: [{ label: "Open", run: () => openSession(sessionID) }],
      })
    })

  const confirmRemove = (routine: RoutineView) =>
    ctx.dialogs.open((dialog) => (
      <ui.Dialog
        title={`Delete ${routine.name}?`}
        description="The routine and its run history go away. Sessions from past runs stay."
        footer={
          <>
            <ui.Button variant="ghost" onClick={dialog.close}>
              Cancel
            </ui.Button>
            <ui.Button
              variant="danger"
              onClick={() => {
                dialog.close()
                void act(`remove:${routine.id}`, () => ctx.client.rpc(Routines).remove({ id: routine.id }), `Deleted ${routine.name}`)
              }}
            >
              Delete
            </ui.Button>
          </>
        }
      />
    ))

  const RunRow = (props: { run: RunRecordView }) => (
    <ui.SettingsRow
      title={`${when(props.run.firedAt, now())}${props.run.trigger === "manual" ? " · manual" : ""}`}
      description={props.run.error ? `Failed: ${props.run.error}` : props.run.sessionID}
    >
      <Show when={props.run.sessionID}>
        {(sessionID) => (
          <ui.Button size="small" variant="ghost" icon="arrow-up-right" onClick={() => openSession(sessionID())}>
            Open
          </ui.Button>
        )}
      </Show>
    </ui.SettingsRow>
  )

  const RoutineSection = (props: { routine: RoutineView }) => {
    const routine = () => props.routine
    return (
      <ui.SettingsSection
        title={routine().name}
        footer={
          <Show when={routine().lastError}>
            {(error) => <span style={{ color: "var(--text-danger, #e5484d)" }}>Last error: {error()}</span>}
          </Show>
        }
      >
        <ui.SettingsRow
          id={`routine-${routine().id}`}
          title={routine().enabled ? "On" : "Off"}
          description={`${routine().schedule} · ${routine().timezone ?? "local time"} · ID ${routine().id}`}
        >
          <ui.Switch
            label={`Run ${routine().name} on schedule`}
            hideLabel
            checked={routine().enabled}
            disabled={busy() === `enable:${routine().id}`}
            onChange={(enabled) =>
              void act(`enable:${routine().id}`, () => ctx.client.rpc(Routines).setEnabled({ id: routine().id, enabled }))
            }
          />
        </ui.SettingsRow>
        <ui.SettingsRow
          title="Next runs"
          description={routine().nextRuns.length ? routine().nextRuns.map((time) => when(time, now())).join("\n") : "None while off"}
        />
        <ui.SettingsRow
          title="Runs in"
          description={`${routine().directory} · agent ${routine().agent ?? "default"} · model ${routine().model ?? "default"} · permissions auto-approved`}
        />
        <ui.SettingsRow title="Prompt" description={<div style={{ "white-space": "pre-wrap" }}>{routine().prompt}</div>} />
        <For each={routine().history.slice(0, RECENT_RUNS)} fallback={<ui.SettingsRow title="No runs yet" />}>
          {(run) => <RunRow run={run} />}
        </For>
        <ui.SettingsRow title="Actions">
          <div style={{ display: "flex", gap: "8px" }}>
            <ui.Button size="small" icon="enter" busy={busy() === `run:${routine().id}`} onClick={() => void runNow(routine())}>
              Run now
            </ui.Button>
            <ui.Button
              size="small"
              variant="danger"
              icon="trash"
              busy={busy() === `remove:${routine().id}`}
              onClick={() => confirmRemove(routine())}
            >
              Delete
            </ui.Button>
          </div>
        </ui.SettingsRow>
      </ui.SettingsSection>
    )
  }

  return (
    <ui.SettingsLayout
      title="Routines"
      description="Prompts that run on a cron schedule, each in a fresh session. Make one in any session with /routine."
      actions={
        <ui.Tooltip value="Refresh">
          <ui.IconButton icon="refresh" label="Refresh" busy={data.loading} onClick={() => void refetch()} />
        </ui.Tooltip>
      }
    >
      <Show when={!data.error} fallback={<ui.SettingsSection><ui.SettingsRow title="Cannot load routines" description={String(data.error)} /></ui.SettingsSection>}>
        <Show when={data.latest} fallback={<ui.Loader size="large" />}>
          {(result) => (
            <For
              each={result().routines}
              fallback={
                <ui.SettingsSection>
                  <ui.SettingsRow
                    title="No routines yet"
                    description={`Type /routine in any session, such as: /routine every weekday at 9am, summarize my open PRs. Files live in ${result().stateDir}.`}
                  />
                </ui.SettingsSection>
              }
            >
              {(routine) => <RoutineSection routine={routine} />}
            </For>
          )}
        </Show>
      </Show>
    </ui.SettingsLayout>
  )
}

export default Plugin.define({
  setup(ctx) {
    ctx.add(SettingsPage, {
      id: PAGE_ID,
      icon: "status",
      title: "Routines",
      entries: [{ id: PAGE_ID, title: "Routines", keywords: "routine cron schedule automation" }],
      render: () => <RoutinesPage />,
    })

    ctx.add(Command, {
      id: "open",
      title: "Open routines",
      keywords: "routine cron schedule automation",
      run: () => ctx.layout.settings(PAGE_ID),
    })
  },
})
