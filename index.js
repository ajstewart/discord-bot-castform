const { pipe, map, forEach, merge, share } = require('callbag-basics')
const tap = require('callbag-tap')
const timer = require('callbag-date-timer')
const of = require('callbag-of')

require('./server')
const bot = require('./bot')

const aw = require('./aw')
const pogo = require('./pogo')
const model = require('./model-th0rnleaf')

const { run, hour2meridian } = require('./utils')

const JSONDB = require('node-json-db')

const PULLHOUR = 2 // NOTE: apparently pull-hour/query-hour-offset changes every now and then without much rhyme or reason :|
const HOURS =
      new Array(24).fill().map((_, i) => `${i}`.padStart(2, '0')) || // Debug: ALL DAY, EVERY DAY
      new Array(3).fill(0 + PULLHOUR).map((v, i) => String((24 + v + i * 8) % 24).padStart(2, '0'))

run(async () => {
  // Await the bot
  await bot.client

  // Load locations to check
  const locations = new JSONDB('locations', true, true).getData('/')

  // Setup callbags
  Object.keys(locations)
    .filter(location => ['kolkata'].includes(location)) // Debug: Quickly filter locations when testing
    .forEach(key => {
      const location = locations[key]

      // Get forecast and predictions
      const weathers$ = pipe(
        merge(
          ...HOURS.map(hour => timer(new Date(`2018-01-01T${hour}:05${location.timezone}`), 24 * 60 * 60 * 1000)),
          // of(0) //DEBUG: Triggers query at start even if it's not time
        ),
        map(_ => location),
        aw.query$,
        map(weathers => weathers.map(({ epoch, querydate, queryhour, date, hour, ...forecast }) => ({
          epoch,
          querydate,
          queryhour,
          date,
          hour,
          forecast,
          prediction: model(forecast)
        }))),
        // tap(console.log), // DEBUG:
        share,
      )

      // Store forecast and predictions
      const weatherDb = new JSONDB(`weather_${key}`, true, true)
      forEach(weathers => {
        weatherDb.push(`/${weathers[0].querydate}/${weathers[0].queryhour}`, weathers, true)
      })(weathers$)

      // Post predictions
      forEach(weathers => {
        const embed = {
          // title: `${locations[key].name}`,
          footer: {
            text: `${weathers[0].querydate}T${weathers[0].queryhour}${location.timezone}`
          },
          fields: [{
            name: locations[key].name,
            value: '​',
            inline: true
          }]
            .concat(weathers.slice(0, 8).map(({ hour, prediction }) => { // DEBUG: Next 8 hours
              const superficials = Object.keys(prediction.superficial)
                .filter(k => prediction.superficial[k] && k !== prediction.dominant)
                .map(k => pogo.labelEmoteMap[k])
              return {
                name: hour2meridian(parseInt(hour)),
                value: `${
                  pogo.labelEmoteMap[prediction.dominant]
                }${
                  superficials.length ? superficials.join('') : ''
                }`,
                inline: true
              }
            }))
        }
        console.log(embed)
        bot.send({ embed })
      })(weathers$)
    })
})
