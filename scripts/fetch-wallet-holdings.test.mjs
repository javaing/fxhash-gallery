import { test, expect } from 'vitest'
import { holdingId, projectNameOf, queryOf, GENTK_CONTRACTS } from './fetch-wallet-holdings.mjs'

test('holdingId is unique across the three gentk contracts', () => {
  expect(holdingId(GENTK_CONTRACTS[0], '358377')).toBe(10_358_377)
  expect(holdingId(GENTK_CONTRACTS[1], '1585350')).toBe(21_585_350)
  expect(holdingId(GENTK_CONTRACTS[2], '30439')).toBe(30_030_439)
  expect(holdingId(GENTK_CONTRACTS[2], '30439')).not.toBe(holdingId(GENTK_CONTRACTS[0], '30439'))
})

test('projectNameOf strips the iteration suffix', () => {
  expect(projectNameOf('Turtle Vision #182')).toBe('Turtle Vision')
  expect(projectNameOf('21/29.7 #1619')).toBe('21/29.7')
  expect(projectNameOf('[WAITING TO BE SIGNED]')).toBe(null)
})

test('queryOf keeps the captured artifact query, or builds one from the seed', () => {
  expect(queryOf('ipfs://QmX/?fxhash=ooA&fxminter=tz1x', 'ooA')).toBe('?fxhash=ooA&fxminter=tz1x')
  expect(queryOf('ipfs://QmX', 'ooB')).toBe('?fxhash=ooB')
  expect(queryOf(null, null)).toBe(null)
})
