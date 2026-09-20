"use client"

import { Popover, PopoverPanel, Transition } from "@headlessui/react"
import useToggleState from "@lib/hooks/use-toggle-state"
import { XMark } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { Text } from "@modules/common/components/ui"
import { Fragment } from "react"
import CountrySelect from "../country-select"
import { Locale } from "@lib/data/locales"

const SideMenuItems = {
  HOME: "/",
  STORE: "/store",
  ACCOUNT: "/account",
  CART: "/cart",
} as const

type SideMenuProps = {
  regions: HttpTypes.StoreRegion[] | null
  locales: Locale[] | null
  currentLocale: string | null
}

const SideMenu = ({ regions }: SideMenuProps) => {
  const countryToggleState = useToggleState()

  return (
    <div className="h-full">
      <div className="flex h-full items-center">
        <Popover className="flex h-full">
          {({ open, close }) => (
            <>
              <div className="relative flex h-full">
                <Popover.Button
                  data-testid="nav-menu-button"
                  className="relative flex h-full items-center text-white transition-colors duration-200 ease-out hover:text-neon focus:outline-none"
                >
                  Menu
                </Popover.Button>
              </div>

              <Transition
                show={open}
                as={Fragment}
                enter="transition ease-out duration-200"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="transition ease-in duration-150"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <PopoverPanel
                  className="fixed inset-0 z-[80] h-dvh w-screen bg-ink-950 text-white"
                  data-testid="nav-menu-popup"
                >
                  <div
                    className="pointer-events-none absolute inset-0 bg-ink-950"
                    data-testid="side-menu-backdrop"
                  />
                  <div className="relative z-10 flex h-full flex-col px-6 py-6 small:px-12">
                    <div className="flex items-center justify-between">
                      <p className="editorial-hud text-neon">Menu</p>
                      <button
                        type="button"
                        data-testid="close-menu-button"
                        onClick={close}
                        className="text-white transition-colors hover:text-neon"
                        aria-label="Close menu"
                      >
                        <XMark />
                      </button>
                    </div>

                    <nav
                      aria-label="Primary"
                      className="flex flex-1 flex-col justify-center"
                    >
                      <ul className="flex flex-col gap-4 small:gap-6">
                        {Object.entries(SideMenuItems).map(([name, href]) => (
                          <li key={name}>
                            <LocalizedClientLink
                              href={href}
                              className="font-display text-5xl font-extrabold uppercase leading-none tracking-tight text-white transition-colors hover:text-neon small:text-7xl"
                              onClick={close}
                              data-testid={`${name.toLowerCase()}-link`}
                            >
                              {name}
                            </LocalizedClientLink>
                          </li>
                        ))}
                      </ul>
                    </nav>

                    <div className="flex flex-col gap-4 border-t border-white/15 pt-6 text-white">
                      {regions && (
                        <div
                          className="text-white"
                          onMouseEnter={countryToggleState.open}
                          onMouseLeave={countryToggleState.close}
                        >
                          <CountrySelect
                            toggleState={countryToggleState}
                            regions={regions}
                          />
                        </div>
                      )}
                      <Text className="txt-compact-small text-white/80">
                        © {new Date().getFullYear()} Gato Gang. All rights
                        reserved.
                      </Text>
                    </div>
                  </div>
                </PopoverPanel>
              </Transition>
            </>
          )}
        </Popover>
      </div>
    </div>
  )
}

export default SideMenu
