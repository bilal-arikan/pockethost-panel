import {
  PocketHostPlugin,
  mkInstance,
  onAfterInstanceFoundAction,
  onAfterInstanceStoppedAction,
  onAfterServerStartAction,
  onAppMountedAction,
  onCliCommandsFilter,
  onGetAllInstancesByExactCriteriaFilter,
  onGetInstanceByRequestInfoFilter,
  onGetOneInstanceByExactCriteriaFilter,
  onGetOrProvisionInstanceUrlFilter,
  onIsInstanceRunningFilter,
  onNewInstanceRecordFilter,
  onSettingsFilter,
} from 'pockethost'
import {
  APEX_DOMAIN,
  HTTP_PROTOCOL,
  PORT,
  PUBLIC_INSTANCE_URL,
} from 'pockethost/core'
import { existsSync, readFileSync } from 'fs'
import { InternalApp } from './InternalApp'
import { LauncherCommand } from './LauncherCommand'
import { PLUGIN_DATA, PLUGIN_NAME, settings } from './constants'
import { DbService } from './db'
import { mkLauncher } from './launcher'
import { dbg, info } from './log'

// ---------------------------------------------------------------------------
// Allowlist gate (panel-only provisioning).
//
// Stock PocketHost auto-provisions an instance for ANY subdomain on first
// request: visiting a random *.apex URL silently creates a new instance.
// We restrict creation to the management panel, which appends the chosen name
// to allowlist.json BEFORE issuing its provision request. The file is read
// fresh on every request (no restart needed when the panel updates it).
// ---------------------------------------------------------------------------
const ALLOWLIST_PATH = PLUGIN_DATA('allowlist.json')

const isAllowlisted = (subdomain: string): boolean => {
  try {
    if (!existsSync(ALLOWLIST_PATH)) return false
    const list = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
    return Array.isArray(list) && list.includes(subdomain)
  } catch {
    return false
  }
}

export const plugin: PocketHostPlugin = async ({}) => {
  dbg(`initializing ${PLUGIN_NAME}`)

  const {
    getInstanceBySubdomain,
    createOrUpdateInstance,
    getInstancesByExactCriteria,
  } = await DbService({})

  onCliCommandsFilter(async (commands) => {
    return [...commands, LauncherCommand()]
  })

  onAppMountedAction(async ({ internalApp }) => {
    dbg(`Mounting internal app`)
    internalApp.use(InternalApp())
  })

  /** Display some informational alerts to help the user get started. */
  onAfterServerStartAction(async () => {
    const protocol = HTTP_PROTOCOL()
    {
      const url = new URL(`${protocol}//*.${APEX_DOMAIN()}`)
      url.port = `${PORT() === 80 || PORT() == 443 ? '' : PORT()}`
      info(`Listening for requests on ${url}`)
    }
    {
      const url = PUBLIC_INSTANCE_URL({ subdomain: 'hello' })
      info(`Try visiting ${url}`)
    }
  })

  /**
   * When a request comes in, return an instance based on subdomain.
   *
   * Allowlist mode: a subdomain is resolved only if it is already known to the
   * registry OR explicitly allowlisted. Unknown subdomains return the incoming
   * (falsy) value, so the core responds "404 not found" instead of spawning a
   * brand-new instance.
   */
  onGetInstanceByRequestInfoFilter(async (instance, context) => {
    const { subdomain } = context
    const existing = getInstanceBySubdomain(subdomain)
    if (!existing && !isAllowlisted(subdomain)) {
      return instance
    }
    return {
      ...(instance || (await mkInstance(subdomain))),
      ...existing,
    }
  })

  /**
   * When a new instance model is instantiated, this filter gives listeners a
   * chance to augment or update the instance data.
   *
   * In this case, the instance data is restored from a local db.
   */
  onNewInstanceRecordFilter(async (instance) => {
    const { subdomain } = instance
    return { ...instance, ...getInstanceBySubdomain(subdomain), id: subdomain }
  })

  /** After an instance has been found, store it to the db */
  onAfterInstanceFoundAction(async (context) => {
    const { instance } = context
    dbg({ instance })
    createOrUpdateInstance(instance)
  })

  const instances: { [_: string]: Promise<string> } = {}

  /**
   * The workhorse. This filter is responsible for launching PocketBase and
   * returning an endpoint URL.
   */
  onGetOrProvisionInstanceUrlFilter(async (url, { instance }) => {
    const { dev, subdomain, version, secrets } = instance

    if (subdomain in instances) return instances[subdomain]!

    dbg({ instance })
    return (instances[subdomain] = mkLauncher(instance))
  })

  onAfterInstanceStoppedAction(async ({ instance }) => {
    const { subdomain } = instance
    delete instances[subdomain]
  })

  onSettingsFilter(async (allSettings) => ({ ...allSettings, ...settings }))

  onIsInstanceRunningFilter(async (isRunning, { instance }) => {
    return isRunning || !!instances[instance.subdomain]
  })

  onGetOneInstanceByExactCriteriaFilter(async (instance, criteria) => {
    return instance || getInstancesByExactCriteria(criteria)[0]
  })

  onGetAllInstancesByExactCriteriaFilter(async (instances, criteria) => {
    return [...instances, ...getInstancesByExactCriteria(criteria)]
  })
}
