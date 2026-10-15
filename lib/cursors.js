/** Opaque pagination cursors for grep (native) and find (pageIndex). */

const MAX = 200

export function createCursorStore() {
  const grep = new Map()
  const find = new Map()
  let g = 0
  let f = 0

  function trim(map) {
    while (map.size > MAX) {
      const first = map.keys().next().value
      if (first === undefined) break
      map.delete(first)
    }
  }

  return {
    storeGrep(cursor) {
      const id = `fff_c${++g}`
      grep.set(id, cursor)
      trim(grep)
      return id
    },
    getGrep(id) {
      return id ? grep.get(id) : undefined
    },
    storeFind(cursor) {
      const id = `${++f}`
      find.set(id, cursor)
      trim(find)
      return id
    },
    getFind(id) {
      return id ? find.get(id) : undefined
    },
    clear() {
      grep.clear()
      find.clear()
    },
  }
}
