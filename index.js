const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const sharp = require('sharp');
const request = require('request');

// Configure AWS SDK
AWS.config.update({
  accessKeyId: 'AKIASKNWGTBDAYPAOSKO',
  secretAccessKey: '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',
  region: 'us-east-1'
});
const s3 = new AWS.S3();
const app = express();
const port = 3000;

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.set('view engine', 'ejs');

app.get('/upload.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

// 1. Create a CloudWatchLogger class to handle logging
class CloudWatchLogger {
  constructor(region, logGroupName) {
    this.logs = new AWS.CloudWatchLogs({ region });
    this.logGroupName = logGroupName;
    this.logStreamName = 'newstream';
    this.sequenceToken = null;
  }


  //2 creating group and stream
  async createLogGroup() {
    const params = {
      logGroupName: this.logGroupName
    };

    try {
      await this.logs.createLogGroup(params).promise();
      console.log(`Log group '${this.logGroupName}' created.`);
    } catch (err) {
      console.error(`Error creating log group '${this.logGroupName}':`, err);
    }
  }

  
  async createLogStream() {
    const params = {
      logGroupName: this.logGroupName,
      logStreamName: this.logStreamName
    };

    try {
      await this.logs.createLogStream(params).promise();
      console.log(`Log stream '${this.logStreamName}' created.`);
    } catch (err) {
      console.error(`Error creating log stream '${this.logStreamName}':`, err);
    }
  }

  //3 retrieve upload sequence token
  async getSequenceToken() {
    const params = {
      logGroupName: this.logGroupName,
      logStreamNamePrefix: this.logStreamName
    };

    try {
      const response = await this.logs.describeLogStreams(params).promise();
      if (response.logStreams.length > 0) {
        const logStream = response.logStreams[0];
        this.sequenceToken = logStream.uploadSequenceToken;
        console.log(`Sequence token: ${this.sequenceToken}`);
      }
    } catch (err) {
      console.error('Error retrieving sequence token:', err);
    }
  }

  //4 sending log meaasge to aws
  async logMessage(message) {
    if (!this.sequenceToken) {
      await this.createLogGroup();
      await this.createLogStream();
      await this.getSequenceToken();
    }


    //5 
    const params = {
      logEvents: [
        {
          message,
          timestamp: Date.now()
        }
      ],
      logGroupName: this.logGroupName,
      logStreamName: this.logStreamName,
      sequenceToken: this.sequenceToken
    };

    try {
      const response = await this.logs.putLogEvents(params).promise();
      this.sequenceToken = response.nextSequenceToken;
      console.log('Log message sent.');
    } catch (err) {
      console.error('Error sending log message:', err);
    }
  }
}

// Create a CloudWatchLogger instance
const logger = new CloudWatchLogger('us-east-1', 'demo2');

app.post('/upload', upload.single('image'), (req, res) => {
  const file = req.file;
  const params = {
    Bucket: 'admin123456',
    Key: file.originalname,
    Body: file.buffer
  };

  s3.upload(params, (err, data) => {
    if (err) {
      console.error(err);
      res.status(500).send('Error uploading image');
    } else {
      console.log('Image uploaded successfully');
      res.status(200).send('Image uploaded successfully');

      // Send log message to Java API
      const logMessage = `Image uploaded: ${file.originalname}`;
      sendLogMessage(logMessage);
    }
  });
});

app.get('/retrieve/:imageName', (req, res) => {
  const imageName = req.params.imageName;
  const params = {
    Bucket: 'admin123456',
    Key: imageName
  };

  s3.getObject(params, (err, data) => {
    if (err) {
      console.error(err);
      res.status(500).send('Error retrieving image');
    } else {
      const imageBuffer = data.Body;
      const contentType = data.ContentType;

      res.set('Content-Type', contentType);
      res.set('Content-Disposition', 'inline');
      res.send(imageBuffer);
    }
  });
});

// Retrieve and display all images in the bucket
app.get('/images', async (req, res) => {
  const bucketName = 'admin123456';

  try {
    const data = await s3.listObjectsV2({ Bucket: bucketName }).promise();
    const images = data.Contents.map(obj => {
      return {
        name: obj.Key,
        url: `http://${bucketName}.s3.amazonaws.com/${obj.Key}`
      };
    });

    // Resize the images
    const resizedImages = await Promise.all(
      images.map(async image => {
        const resizedImageBuffer = await new Promise((resolve, reject) => {
          request.get(image.url, { encoding: null }, (error, response, body) => {
            if (error) {
              reject(error);
            } else {
              sharp(body)
                .resize({ width: 300 }) // Adjust the desired width as needed
                .toBuffer((err, buffer) => {
                  if (err) {
                    reject(err);
                  } else {
                    resolve(buffer);
                  }
                });
            }
          });
        });

        return {
          name: image.name,
          url: `data:image/jpeg;base64,${resizedImageBuffer.toString('base64')}`
        };
      })
    );

    res.render('images', { images: resizedImages });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error retrieving images');
  }
});

// 6 Function to send log message to Java API
function sendLogMessage(message) {
  const options = {
    uri: 'http://java:8080/api/log',
    method: 'POST',
    json: true,
    body: { message }
  };

  request(options, (error, response, body) => {
    if (error) {
      console.error('Error sending log message:', error);
    } else if (response.statusCode !== 200) {
      console.error('Unexpected status code:', response.statusCode);
    } else {
      console.log('Log message sent to Java API');
    }
  });
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});