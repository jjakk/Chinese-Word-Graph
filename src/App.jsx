import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import './App.css'

const HSK_LEVEL_FILES = {
  1: [
    'dictionary/hsk1/hsk1-p1.json',
    'dictionary/hsk1/hsk1-p2.json',
    'dictionary/hsk1/hsk1-p3.json',
  ],
  2: [
    'dictionary/hsk2/hsk2-p1.json',
    'dictionary/hsk2/hsk2-p2.json',
    'dictionary/hsk2/hsk2-p3.json',
  ],
  3: [
    'dictionary/hsk3/hsk3-p1.json',
    'dictionary/hsk3/hsk3-p2.json',
    'dictionary/hsk3/hsk3-p3.json',
  ],
  4: [
    'dictionary/hsk4/hsk4-p1.json',
    'dictionary/hsk4/hsk4-p2.json',
    'dictionary/hsk4/hsk4-p3.json',
    'dictionary/hsk4/hsk4-p4.json',
    'dictionary/hsk4/hsk4-p5.json',
  ],
}

const LEVEL_OPTIONS = Object.keys(HSK_LEVEL_FILES)
  .map((level) => Number(level))
  .sort((a, b) => a - b)

function uniqueByWord(entries) {
  const seen = new Set()
  return entries.filter((entry) => {
    if (seen.has(entry.word)) {
      return false
    }
    seen.add(entry.word)
    return true
  })
}

function inferCharacterPinyins(wordEntry, char) {
  const characters = wordEntry.characters || []
  const pinyinText = (wordEntry.pinyin || '').trim()
  if (!pinyinText) {
    return []
  }

  const syllables = pinyinText.split(/\s+/).filter(Boolean)
  const matchingIndexes = []

  characters.forEach((entryChar, index) => {
    if (entryChar === char) {
      matchingIndexes.push(index)
    }
  })

  if (matchingIndexes.length === 0) {
    return []
  }

  // When pinyin syllable count matches character count, map by position.
  if (syllables.length === characters.length) {
    return matchingIndexes
      .map((index) => syllables[index])
      .filter(Boolean)
  }

  // Fallback for irregular pinyin formatting: keep the original reading string.
  return [pinyinText]
}

function buildGraph(wordEntries) {
  const nodeMap = new Map()
  const linkMap = new Map()

  wordEntries.forEach((wordEntry) => {
    const chars = [...new Set((wordEntry.characters || []).filter(Boolean))]

    chars.forEach((char) => {
      const current = nodeMap.get(char) || {
        id: char,
        char,
        words: [],
        levels: [],
      }
      current.words.push(wordEntry)
      current.levels.push(wordEntry.level)
      nodeMap.set(char, current)
    })

    for (let i = 0; i < chars.length; i += 1) {
      for (let j = i + 1; j < chars.length; j += 1) {
        const source = chars[i]
        const target = chars[j]
        const key = [source, target].sort().join('|')

        const current = linkMap.get(key) || {
          source,
          target,
          words: [],
        }
        current.words.push(wordEntry)
        linkMap.set(key, current)
      }
    }
  })

  const nodes = [...nodeMap.values()].map((node) => {
    const words = uniqueByWord(node.words)
    const minLevel = Math.min(...node.levels)
    const charPinyins = [
      ...new Set(words.flatMap((wordEntry) => inferCharacterPinyins(wordEntry, node.char))),
    ]

    return {
      ...node,
      words,
      charPinyins,
      minLevel,
      wordCount: words.length,
    }
  })

  const links = [...linkMap.values()].map((link) => {
    const words = uniqueByWord(link.words)
    return {
      ...link,
      words,
      label: words.map((entry) => entry.word).join(' / '),
    }
  })

  const connectionScores = new Map(nodes.map((node) => [node.id, 0]))
  links.forEach((link) => {
    const weight = link.words.length
    connectionScores.set(link.source, (connectionScores.get(link.source) || 0) + weight)
    connectionScores.set(link.target, (connectionScores.get(link.target) || 0) + weight)
  })

  const maxConnectionScore = Math.max(1, ...connectionScores.values())
  const maxWordCount = Math.max(1, ...nodes.map((node) => node.wordCount))

  const sizedNodes = nodes.map((node) => {
    const connectionScore = connectionScores.get(node.id) || 0
    const connectivityRatio = connectionScore / maxConnectionScore
    const usageRatio = node.wordCount / maxWordCount
    const combinedInfluence = connectivityRatio * 0.7 + usageRatio * 0.3

    return {
      ...node,
      connectionScore,
      radius: 10 + combinedInfluence * 20,
    }
  })

  return { nodes: sizedNodes, links }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function getNodeId(linkEnd) {
  return typeof linkEnd === 'string' ? linkEnd : linkEnd.id
}

function assignClusterIds(nodes, links) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]))

  links.forEach((link) => {
    const sourceId = getNodeId(link.source)
    const targetId = getNodeId(link.target)
    if (!adjacency.has(sourceId) || !adjacency.has(targetId)) {
      return
    }
    adjacency.get(sourceId).add(targetId)
    adjacency.get(targetId).add(sourceId)
  })

  const visited = new Set()
  const clusterByNode = new Map()
  const clusterSizes = new Map()
  let clusterId = 0

  nodes.forEach((node) => {
    if (visited.has(node.id)) {
      return
    }

    const queue = [node.id]
    visited.add(node.id)
    let size = 0

    while (queue.length > 0) {
      const currentId = queue.shift()
      clusterByNode.set(currentId, clusterId)
      size += 1

      adjacency.get(currentId).forEach((neighborId) => {
        if (!visited.has(neighborId)) {
          visited.add(neighborId)
          queue.push(neighborId)
        }
      })
    }

    clusterSizes.set(clusterId, size)
    clusterId += 1
  })

  return { clusterByNode, clusterSizes }
}

function createClusterSeparationForce(minSpacing = 120, strength = 0.12) {
  let nodeList = []

  function force(alpha) {
    const clusters = new Map()

    nodeList.forEach((node) => {
      const clusterId = node.clusterId ?? -1
      const current = clusters.get(clusterId) || {
        x: 0,
        y: 0,
        count: 0,
        members: [],
      }

      current.x += node.x
      current.y += node.y
      current.count += 1
      current.members.push(node)
      clusters.set(clusterId, current)
    })

    const clusterEntries = [...clusters.values()].map((cluster) => ({
      ...cluster,
      x: cluster.x / cluster.count,
      y: cluster.y / cluster.count,
    }))

    for (let i = 0; i < clusterEntries.length; i += 1) {
      for (let j = i + 1; j < clusterEntries.length; j += 1) {
        const a = clusterEntries[i]
        const b = clusterEntries[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.hypot(dx, dy) || 0.001
        const dynamicMinDistance =
          minSpacing + (Math.sqrt(a.count) + Math.sqrt(b.count)) * 10

        if (distance >= dynamicMinDistance) {
          continue
        }

        const overlap = dynamicMinDistance - distance
        const push = (overlap / distance) * strength * alpha
        const offsetX = dx * push
        const offsetY = dy * push

        a.members.forEach((node) => {
          node.vx -= offsetX / a.count
          node.vy -= offsetY / a.count
        })

        b.members.forEach((node) => {
          node.vx += offsetX / b.count
          node.vy += offsetY / b.count
        })
      }
    }
  }

  force.initialize = (newNodes) => {
    nodeList = newNodes
  }

  return force
}

function createNodeToLinkRepulsionForce(minDistance = 20, strength = 0.12) {
  let nodeList = []
  let linkList = []

  function force(alpha) {
    if (nodeList.length === 0 || linkList.length === 0) {
      return
    }

    nodeList.forEach((node) => {
      linkList.forEach((link) => {
        const source = link.source
        const target = link.target

        if (!source || !target || source.id == null || target.id == null) {
          return
        }

        if (node.id === source.id || node.id === target.id) {
          return
        }

        const x1 = source.x
        const y1 = source.y
        const x2 = target.x
        const y2 = target.y
        if (
          x1 == null ||
          y1 == null ||
          x2 == null ||
          y2 == null
        ) {
          return
        }

        const dx = x2 - x1
        const dy = y2 - y1
        const lenSq = dx * dx + dy * dy
        if (lenSq === 0) {
          return
        }

        let t = ((node.x - x1) * dx + (node.y - y1) * dy) / lenSq
        t = clamp(t, 0, 1)
        const closestX = x1 + t * dx
        const closestY = y1 + t * dy
        const offsetX = node.x - closestX
        const offsetY = node.y - closestY
        const distance = Math.hypot(offsetX, offsetY) || 0.001
        const dynamicMinDistance = minDistance + node.radius * 0.45

        if (distance >= dynamicMinDistance) {
          return
        }

        const overlap = dynamicMinDistance - distance
        const push = (overlap / distance) * strength * alpha
        node.vx += offsetX * push
        node.vy += offsetY * push
      })
    })
  }

  force.initialize = (newNodes, newLinks) => {
    nodeList = newNodes || []
    linkList = newLinks || []
  }

  return force
}

function App() {
  const [selectedLevel, setSelectedLevel] = useState(LEVEL_OPTIONS[0])
  const [isCumulative, setIsCumulative] = useState(true)
  const [levelWordData, setLevelWordData] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadErrors, setLoadErrors] = useState([])
  const graphRef = useRef(null)
  const isolatedGraphRef = useRef(null)
  const containerRef = useRef(null)
  const isolatedContainerRef = useRef(null)
  const tooltipRef = useRef(null)
  const isolatedTooltipRef = useRef(null)
  const [size, setSize] = useState({ width: 1000, height: 680 })
  const [isolatedSize, setIsolatedSize] = useState({ width: 1000, height: 680 })

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      setLoading(true)

      const errors = []

      const entries = await Promise.all(
        LEVEL_OPTIONS.map(async (level) => {
          const files = HSK_LEVEL_FILES[level] || []

          const pageResults = await Promise.all(
            files.map(async (filePath) => {
              try {
                const response = await fetch(`${import.meta.env.BASE_URL}${filePath}`)
                if (!response.ok) {
                  throw new Error(`Could not load ${filePath}`)
                }

                const page = await response.json()
                return (page.words || []).map((wordEntry) => ({
                  ...wordEntry,
                  level,
                }))
              } catch (error) {
                errors.push(error.message)
                return []
              }
            }),
          )

          return [level, pageResults.flat()]
        }),
      )

      if (!isMounted) {
        return
      }

      const mapped = Object.fromEntries(entries)
      setLevelWordData(mapped)
      setLoadErrors(errors)
      setLoading(false)
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [])

  const words = useMemo(() => {
    const levels =
      isCumulative
        ? LEVEL_OPTIONS.filter((candidate) => candidate <= selectedLevel)
        : [selectedLevel]

    return levels.flatMap((level) => levelWordData[level] || [])
  }, [isCumulative, levelWordData, selectedLevel])

  const graph = useMemo(() => buildGraph(words), [words])
  const linkedGraph = useMemo(() => {
    const connectedNodeIds = new Set(
      graph.links.flatMap((link) => [getNodeId(link.source), getNodeId(link.target)]),
    )

    return {
      nodes: graph.nodes.filter((node) => connectedNodeIds.has(node.id)),
      links: graph.links,
    }
  }, [graph])

  const isolatedNodes = useMemo(() => {
    const connectedNodeIds = new Set(
      graph.links.flatMap((link) => [getNodeId(link.source), getNodeId(link.target)]),
    )

    return graph.nodes.filter((node) => !connectedNodeIds.has(node.id))
  }, [graph])

  useEffect(() => {
    if (!containerRef.current) {
      return undefined
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = clamp(Math.round(entry.contentRect.width), 360, 1600)
      const height = clamp(Math.round(entry.contentRect.height), 420, 1200)
      setSize({ width, height })
    })

    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!isolatedContainerRef.current) {
      return undefined
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = clamp(Math.round(entry.contentRect.width), 360, 1600)
      const height = clamp(Math.round(entry.contentRect.height), 420, 1200)
      setIsolatedSize({ width, height })
    })

    resizeObserver.observe(isolatedContainerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    const svgElement = graphRef.current
    const tooltipElement = tooltipRef.current
    if (!svgElement || !tooltipElement || !containerRef.current) {
      return undefined
    }

    const { width, height } = size
    const { nodes, links } = linkedGraph
    const graphPadding = 30
    const getScaledRadius = (node) => node.radius
    const maxConnectionScore = Math.max(
      1,
      ...nodes.map((node) => node.connectionScore || 0),
    )
    const connectionRatioForNode = (node) =>
      clamp((node.connectionScore || 0) / maxConnectionScore, 0, 1)
    const outerRingRadius = Math.max(40, Math.min(width, height) / 2 - graphPadding - 28)
    const svg = d3.select(svgElement)
    const tooltip = d3.select(tooltipElement)

    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${width} ${height}`)

    if (nodes.length === 0) {
      return undefined
    }

    svg
      .append('defs')
      .append('clipPath')
      .attr('id', 'graph-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height)

    const chart = svg
      .append('g')
      .attr('class', 'chart-layer')
      .attr('clip-path', 'url(#graph-clip)')

    const zoom = d3
      .zoom()
      .scaleExtent([0.5, 4])
      .on('zoom', (event) => {
        chart.attr('transform', event.transform)
      })

    svg.call(zoom).on('dblclick.zoom', null)

    const linkLines = chart
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('class', 'link-line')
      .attr('stroke-width', (d) => 1.2 + Math.sqrt(d.words.length))

    const linkLabels = chart
      .append('g')
      .attr('class', 'link-labels')
      .selectAll('text')
      .data(links)
      .join('text')
      .attr('class', 'link-label')
      .text((d) => d.label)

    const nodeGroup = chart
      .append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node-group')

    const circles = nodeGroup
      .append('circle')
      .attr('class', 'node-circle')
      .attr('r', (d) => getScaledRadius(d))
      .attr('fill', (d) => (d.minLevel === 1 ? '#1f6f8b' : '#ef6c57'))

    const nodeLabels = nodeGroup
      .append('text')
      .attr('class', 'node-label')
      .attr('font-size', (d) => `${clamp(getScaledRadius(d) * 0.55, 10, 24)}px`)
      .text((d) => d.char)

    circles.append('title').text((d) => `字: ${d.char}`)

    function showTooltip(html) {
      tooltip
        .style('opacity', 1)
        .style('visibility', 'visible')
        .html(html)
    }

    function moveTooltip(event) {
      const container = containerRef.current
      if (!container) {
        return
      }

      const [x, y] = d3.pointer(event, container)
      const offset = 14
      const edgePadding = 8
      const tooltipWidth = tooltipElement.offsetWidth || 0
      const tooltipHeight = tooltipElement.offsetHeight || 0
      const maxLeft = container.clientWidth - tooltipWidth - edgePadding
      const maxTop = container.clientHeight - tooltipHeight - edgePadding

      const left = clamp(x + offset, edgePadding, Math.max(edgePadding, maxLeft))
      const top = clamp(y + offset, edgePadding, Math.max(edgePadding, maxTop))

      tooltip.style('left', `${left}px`).style('top', `${top}px`)
    }

    function hideTooltip() {
      tooltip.style('opacity', 0).style('visibility', 'hidden')
    }

    nodeGroup
      .on('mouseenter', (event, node) => {
        const wordItems = node.words
          .slice(0, 10)
          .map(
            (word) =>
              `<li><b>${word.word}</b> (${word.pinyin}) - ${word.meaning}</li>`,
          )
          .join('')

        showTooltip(
          `<h3>字: ${node.char}</h3>
            <p>Pinyin: ${node.charPinyins.join(' / ') || 'N/A'}</p>
           <p>HSK: ${node.minLevel}</p>
           <p>Words using this character: ${node.wordCount}</p>
           <ul>${wordItems}</ul>`,
        )
        moveTooltip(event)
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip)

    function linkTooltipHtml(link) {
      const items = link.words
        .map(
          (word) =>
            `<li><b>${word.word}</b> (${word.pinyin}) - ${word.meaning}</li>`,
        )
        .join('')

      return `<h3>Shared word link</h3><ul>${items}</ul>`
    }

    linkLines
      .on('mouseenter', (event, link) => {
        showTooltip(linkTooltipHtml(link))
        moveTooltip(event)
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip)

    linkLabels
      .on('mouseenter', (event, link) => {
        showTooltip(linkTooltipHtml(link))
        moveTooltip(event)
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip)

    const { clusterByNode, clusterSizes } = assignClusterIds(nodes, links)
    nodes.forEach((node) => {
      node.clusterId = clusterByNode.get(node.id) ?? -1
      node.clusterSize = clusterSizes.get(node.clusterId) ?? 1
    })

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink(links)
          .id((d) => d.id)
          .distance((d) => {
            const sourceRadius = getScaledRadius(d.source)
            const targetRadius = getScaledRadius(d.target)
            const averageRadius = (sourceRadius + targetRadius) / 2
            return 54 + d.words.length * 5 + averageRadius * 1.35
          })
          .strength((d) => {
            const sourceRadius = getScaledRadius(d.source)
            const targetRadius = getScaledRadius(d.target)
            const averageRadius = (sourceRadius + targetRadius) / 2
            return clamp(0.52 - averageRadius * 0.007, 0.22, 0.54)
          }),
      )
      .force(
        'charge',
        d3
          .forceManyBody()
          .strength(
            (d) =>
              -44 -
              getScaledRadius(d) * 4.4 -
              connectionRatioForNode(d) * 120,
          ),
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.065))
      .force('y', d3.forceY(height / 2).strength(0.065))
      .force(
        'radial',
        d3
          .forceRadial(
            (d) => {
              const connectionRatio = connectionRatioForNode(d)
              return (1 - connectionRatio) * outerRingRadius
            },
            width / 2,
            height / 2,
          )
          .strength(0.16),
      )
      .force(
        'collision',
        d3
          .forceCollide()
          .radius(
            (d) =>
              getScaledRadius(d) +
              clamp(getScaledRadius(d) * 0.2, 1, 8) +
              connectionRatioForNode(d) * 6,
          ),
      )
            .force('node-link-repulsion', createNodeToLinkRepulsionForce(22, 0.18))
      .force('cluster-separation', createClusterSeparationForce(86, 0.1))

    const drag = d3
      .drag()
      .on('start', (event, d) => {
        if (!event.active) {
          simulation.alphaTarget(0.3).restart()
        }
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        const scaledRadius = getScaledRadius(d)
        d.fx = clamp(event.x, scaledRadius + graphPadding, width - scaledRadius - graphPadding)
        d.fy = clamp(event.y, scaledRadius + graphPadding, height - scaledRadius - graphPadding)
      })
      .on('end', (event, d) => {
        if (!event.active) {
          simulation.alphaTarget(0)
        }
        d.fx = null
        d.fy = null
      })

    circles.call(drag)

    simulation.on('tick', () => {
      nodes.forEach((node) => {
        const scaledRadius = getScaledRadius(node)
        node.x = clamp(node.x, scaledRadius + graphPadding, width - scaledRadius - graphPadding)
        node.y = clamp(node.y, scaledRadius + graphPadding, height - scaledRadius - graphPadding)
      })

      linkLines
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y)

      linkLabels
        .attr('x', (d) => clamp((d.source.x + d.target.x) / 2, graphPadding, width - graphPadding))
        .attr('y', (d) => clamp((d.source.y + d.target.y) / 2, graphPadding, height - graphPadding))

      nodeGroup.attr('transform', (d) => `translate(${d.x}, ${d.y})`)
      nodeLabels.attr('dy', '0.35em')
    })

    return () => {
      simulation.stop()
    }
  }, [linkedGraph, size])

  useEffect(() => {
    const isolatedSvgElement = isolatedGraphRef.current
    const tooltipElement = isolatedTooltipRef.current
    if (!isolatedSvgElement || !tooltipElement || !isolatedContainerRef.current) {
      return undefined
    }

    const { width, height } = isolatedSize
    const svg = d3.select(isolatedSvgElement)
    const tooltip = d3.select(tooltipElement)

    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${width} ${height}`)

    if (isolatedNodes.length === 0) {
      return undefined
    }

    const chart = svg
      .append('g')
      .attr('class', 'isolated-chart-layer')

    const zoom = d3
      .zoom()
      .scaleExtent([0.5, 4])
      .on('zoom', (event) => {
        chart.attr('transform', event.transform)
      })

    svg.call(zoom).on('dblclick.zoom', null)

    const isolatedSimulationNodes = isolatedNodes.map((node) => ({
      ...node,
      x: width / 2 + (Math.random() - 0.5) * 36,
      y: height / 2 + (Math.random() - 0.5) * 36,
      displayRadius: clamp(node.radius, 12, 26),
    }))

    const nodeGroup = chart
      .append('g')
      .attr('class', 'isolated-nodes')
      .selectAll('g')
      .data(isolatedSimulationNodes)
      .join('g')
      .attr('transform', (node) => `translate(${node.x}, ${node.y})`)

    nodeGroup
      .append('circle')
      .attr('class', 'node-circle isolated-circle')
      .attr('r', (node) => node.displayRadius)
      .attr('fill', (node) => (node.minLevel <= 2 ? '#1f6f8b' : '#ef6c57'))

    nodeGroup
      .append('text')
      .attr('class', 'node-label')
      .attr('font-size', (node) => `${clamp(node.displayRadius * 0.58, 10, 18)}px`)
      .attr('dy', '0.35em')
      .text((node) => node.char)

    function showTooltip(html) {
      tooltip
        .style('opacity', 1)
        .style('visibility', 'visible')
        .html(html)
    }

    function moveTooltip(event) {
      const container = isolatedContainerRef.current
      if (!container) {
        return
      }

      const [x, y] = d3.pointer(event, container)
      const offset = 14
      const edgePadding = 8
      const tooltipWidth = tooltipElement.offsetWidth || 0
      const tooltipHeight = tooltipElement.offsetHeight || 0
      const maxLeft = container.clientWidth - tooltipWidth - edgePadding
      const maxTop = container.clientHeight - tooltipHeight - edgePadding

      const left = clamp(x + offset, edgePadding, Math.max(edgePadding, maxLeft))
      const top = clamp(y + offset, edgePadding, Math.max(edgePadding, maxTop))

      tooltip.style('left', `${left}px`).style('top', `${top}px`)
    }

    function hideTooltip() {
      tooltip.style('opacity', 0).style('visibility', 'hidden')
    }

    nodeGroup
      .on('mouseenter', (event, node) => {
        const wordItems = node.words
          .slice(0, 10)
          .map(
            (word) =>
              `<li><b>${word.word}</b> (${word.pinyin}) - ${word.meaning}</li>`,
          )
          .join('')

        showTooltip(
          `<h3>字: ${node.char}</h3>
            <p>Pinyin: ${node.charPinyins.join(' / ') || 'N/A'}</p>
            <p>HSK: ${node.minLevel}</p>
            <p>Words using this character: ${node.wordCount}</p>
            <ul>${wordItems}</ul>`,
        )
        moveTooltip(event)
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip)

    const panelPadding = 28
    const simulation = d3
      .forceSimulation(isolatedSimulationNodes)
      .force(
        'charge',
        d3
          .forceManyBody()
          .strength((node) => -45 - node.displayRadius * 6),
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.17))
      .force('y', d3.forceY(height / 2).strength(0.17))
      .force(
        'collision',
        d3
          .forceCollide()
          .radius((node) => node.displayRadius + 4),
      )

    const drag = d3
      .drag()
      .on('start', (event, node) => {
        if (!event.active) {
          simulation.alphaTarget(0.3).restart()
        }
        node.fx = node.x
        node.fy = node.y
      })
      .on('drag', (event, node) => {
        node.fx = clamp(
          event.x,
          node.displayRadius + panelPadding,
          width - node.displayRadius - panelPadding,
        )
        node.fy = clamp(
          event.y,
          node.displayRadius + panelPadding,
          height - node.displayRadius - panelPadding,
        )
      })
      .on('end', (event, node) => {
        if (!event.active) {
          simulation.alphaTarget(0)
        }
        node.fx = null
        node.fy = null
      })

    nodeGroup.selectAll('.isolated-circle').call(drag)

    simulation.on('tick', () => {
      isolatedSimulationNodes.forEach((node) => {
        node.x = clamp(
          node.x,
          node.displayRadius + panelPadding,
          width - node.displayRadius - panelPadding,
        )
        node.y = clamp(
          node.y,
          node.displayRadius + panelPadding,
          height - node.displayRadius - panelPadding,
        )
      })

      nodeGroup.attr('transform', (node) => `translate(${node.x}, ${node.y})`)
    })

    return () => {
      simulation.stop()
      tooltip.style('opacity', 0).style('visibility', 'hidden')
    }
  }, [isolatedNodes, isolatedSize])

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Mandarin Character Graph</h1>
        <p>
          Select an HSK level and toggle cumulative mode to visualize linked
          characters separately from standalone ones.
        </p>
        {loading && <p className="status-line">Loading dictionary data...</p>}
        {!loading && loadErrors.length > 0 && (
          <p className="status-line status-error">
            Some dictionary files could not be loaded. Loaded what was available.
          </p>
        )}
        <div className="header-controls">
          <label htmlFor="hsk-level-select">
            HSK Level
            <select
              id="hsk-level-select"
              value={selectedLevel}
              onChange={(event) => setSelectedLevel(Number(event.target.value))}
              disabled={loading}
            >
              {LEVEL_OPTIONS.map((level) => (
                <option key={level} value={level}>
                  HSK {level}
                </option>
              ))}
            </select>
          </label>

          <div className="toggle-control">
            <span>Cumulative</span>
            <button
              type="button"
              className={`toggle-button ${isCumulative ? 'active' : ''}`}
              onClick={() => setIsCumulative((value) => !value)}
              disabled={loading}
              aria-pressed={isCumulative}
            >
              {isCumulative ? 'On (HSK 1 to selected)' : 'Off (Selected level only)'}
            </button>
          </div>
        </div>
      </header>

      <div className="graph-views">
        <section className="graph-panel" ref={containerRef}>
          <h2>Linked Character Graph</h2>
          <svg ref={graphRef} role="img" aria-label="Chinese character relationship graph" />
          <div ref={tooltipRef} className="tooltip" />
          {!loading && linkedGraph.nodes.length === 0 && words.length > 0 && (
            <div className="empty-state">
              No linked nodes for this selection. See standalone characters in the right panel.
            </div>
          )}
          {!loading && words.length === 0 && (
            <div className="empty-state">
              No words loaded for this selection. Check dictionary files in /public/dictionary/hsk1 through /public/dictionary/hsk4.
            </div>
          )}
        </section>

        <section className="graph-panel isolated-panel" ref={isolatedContainerRef}>
          <h2>Standalone Characters (No Links)</h2>
          <svg ref={isolatedGraphRef} role="img" aria-label="Standalone Chinese characters graph" />
          <div ref={isolatedTooltipRef} className="tooltip" />
          {!loading && isolatedNodes.length === 0 && (
            <div className="empty-state">No standalone characters in this selection.</div>
          )}
        </section>
      </div>
    </main>
  )
}

export default App
