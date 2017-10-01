const fs = require('fs');
const readline = require('readline');
const google = require('googleapis');
const googleAuth = require('google-auth-library');
const config = require('./config.json');
const keys = require('./keys.json');
const log = require('ee-log');
const fetch = require('node-fetch');

class GoogleAuthorizationHandler {
  constructor() {
    // If modifying these scopes, delete your previously saved credentials
    // at .credentials/sheets.googleapis.com-nodejs-quickstart.json
    this.SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
    this.TOKEN_DIR = '.credentials/';
    this.TOKEN_PATH = this.TOKEN_DIR + 'sheets.googleapis.com-nodejs-quickstart.json';
  }
  
  getAuth() {
    return new Promise((resolve, reject) => {
      if (this._auth) {
        return resolve(this._auth);
      }
      
      return this.getCredentials(resolve);
    }).catch(e => console.error);
  }
  
  getCredentials(resolve) {
    // Load client secrets from a local file.
    fs.readFile('client_secret.json', (err, content) => {
      if (err) {
        console.log('Error loading client secret file: ' + err);
        return;
      }
      // Authorize a client with the loaded credentials, then call the
      // Google Sheets API.
      this.authorize(JSON.parse(content), (auth) => {
        this._auth = auth;
        resolve(auth);
      });
    });
  }
    
  /**
   * Create an OAuth2 client with the given credentials, and then execute the
   * given callback function.
   *
   * @param {Object} credentials The authorization client credentials.
   * @param {function} callback The callback to call with the authorized client.
   */
  authorize(credentials, callback) {
    const clientSecret = credentials.installed.client_secret;
    const clientId = credentials.installed.client_id;
    const redirectUrl = credentials.installed.redirect_uris[0];
    const auth = new googleAuth();
    const oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

    // Check if we have previously stored a token.
    fs.readFile(this.TOKEN_PATH, (err, token) => {
      if (err) {
        this.getNewToken(oauth2Client, callback);
      } else {
        oauth2Client.credentials = JSON.parse(token);
        callback(oauth2Client);
      }
    });
  }
  
  /**
   * Get and store new token after prompting for user authorization, and then
   * execute the given callback with the authorized OAuth2 client.
   *
   * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
   * @param {getEventsCallback} callback The callback to call with the authorized
   *     client.
   */
  getNewToken(oauth2Client, callback) {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES
    });

    console.log('Authorize this app by visiting this url: ', authUrl);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();
      oauth2Client.getToken(code, (err, token) => {
        if (err) {
          console.log('Error while trying to retrieve access token', err);
          return;
        }
        oauth2Client.credentials = token;
        this.storeToken(token);
        callback(oauth2Client);
      });
    });
  }
  
  /**
   * Store token to disk be used in later program executions.
   *
   * @param {Object} token The token to store to disk.
   */
   storeToken(token) {
    try {
      fs.mkdirSync(this.TOKEN_DIR);
    } catch (err) {
      if (err.code != 'EEXIST') {
        throw err;
      }
    }
    fs.writeFile(this.TOKEN_PATH, JSON.stringify(token));
    console.log('Token stored to ' + TOKEN_PATH);
  }
}

class SheetHandler {
  constructor(config) {
    this.config = config;
    this.googleAuthorization = new GoogleAuthorizationHandler();
    this.sheets = google.sheets('v4');
  }
  
  getSheet() {
    return this.googleAuthorization.getAuth().then((auth) => {
      return new Promise((resolve, reject) => {
        this.sheets.spreadsheets.values.get({
          auth: auth,
          spreadsheetId: this.config.spreadsheetId,
          range: '!A2:I',
        }, function(err, response) {
          if (err) {
            console.log('The API returned an error: ' + err);
            return reject(err);
          }
          
          return resolve(response);
        });
      }).catch(e => console.error);
    });
  } 
  
  updateSheet(locationData) {
    return this.googleAuthorization.getAuth().then((auth) => {
      return new Promise((resolve, reject) => {
        const updateRequest = {
          auth: auth,
          spreadsheetId: this.config.spreadsheetId,
          range: 'H2:I' + (locationData.length + 2),
          valueInputOption: 'USER_ENTERED',
          resource : {
            values: locationData.reduce((accumulator, location) => {
              accumulator.push([location.lat, location.lng]);
              
              return accumulator; 
            }, []),
          }
        };
        
        this.sheets.spreadsheets.values.update(updateRequest, function(err, response) {
          if (err) {
            return reject(err);
          }
          
          return resolve(response);
        }).catch(e => console.error);
      });
    });
  }
}

class GoogleGeocodeFetcher {
  constructor(apiUrl, events, getCountryCode) {
    this.GEOCODE_API = 'https://maps.googleapis.com/maps/api/geocode/json?address=';
    this.positions = [];
  }

  getPosition(location) {
    const city = location[2];
    const country = location[1];
    
    if (!city || !country) {
      console.error(`No city or country not found: ${location}`);
    }
    
    const apiURI = `${this.GEOCODE_API}${encodeURIComponent(`${city},${country}`)}&key=${keys.geocodeApiKey}`;
    
    return fetch(apiURI)
    .then((response) => {
      return response.json();
    }).then((result) => {
      if (result.results[0]) {
        const location = result.results[0].geometry.location;
        
        // determ if the location was already added
        const exisitingLocationWithSameCoordinates = this.positions
          .find((existingLocation) => { 
            return existingLocation.lat == location.lat && 
              existingLocation.lng == location.lng;
          });
        
        // add random offset to current location  
        if (exisitingLocationWithSameCoordinates) {
          // eather add or substract offset
          const operatorLat = Math.random() >= 0.5;
          const operatorLng = Math.random() >= 0.5;
          const offsetLat = Math.random() / 100;
          const offsetLng = Math.random() / 100;
          
          location.lat = operatorLat ? location.lat + offsetLat : location.lat - offsetLat;
          location.lng = operatorLng ? location.lng + offsetLng : location.lng - offsetLng;
        }
        
        this.positions.push(location);
        return location;
      }
      
      console.error(`Location could not be fetched: ${apiURI}`);
      return { lat: 0, lng: 0};
    }).catch(e => console.error);
  }
}


const sheetHandler = new SheetHandler(config);
const geocodeFetcher = new GoogleGeocodeFetcher();

sheetHandler.getSheet().then((result) => {
  const data = result.values;
  const promises = data.map((location, index) => {
    return new Promise((resolve, reject) => {
      // google rate limit 50 requests per second server and client side
      return setTimeout(
        () => {
          geocodeFetcher.getPosition(location).then(
            (result) => {
              resolve(result);
          });
        }, 
        100*index);
    })
  });
  
  Promise.all(promises)
    .then((result) => {
      return sheetHandler.updateSheet(result);
    })
    .then((result) => {
      console.log(result);
    })
    .catch(e => console.error);
})
.then(() => {
  console.log('here we go', result);
})
.catch(e => console.error);
