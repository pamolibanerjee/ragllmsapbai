/* Helper file to process and store vector embeddings in HANA Cloud */

const cds = require('@sap/cds');
const { INSERT, DELETE, SELECT } = cds.ql;
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const fs = require('fs');
const{ Files } = cds.entities;
//const { PDFDocument } = require('pdf-lib');
const { PDFLoader } = require('langchain/document_loaders/fs/pdf');
const { Readable, PassThrough } = require("stream");
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const express = require('express');
const fileReader = require('filereader');
const app = express();



// Helper method to convert embeddings to buffer for insertion
let array2VectorBuffer = (data) => {
  const sizeFloat = 4;
  const sizeDimensions = 4;
  const bufferSize = data.length * sizeFloat + sizeDimensions;

  const buffer = Buffer.allocUnsafe(bufferSize);
  // write size into buffer
  buffer.writeUInt32LE(data.length, 0);
  data.forEach((value, index) => {
    buffer.writeFloatLE(value, index * sizeFloat + sizeDimensions);
  });
  return buffer;
};

// Helper method to delete file if it already exists
const deleteIfExists = (filePath) => {
  try {
    fs.unlink(filePath, (err) => {
      if (err) {
        if (err.code === 'ENOENT') {
          console.log('File does not exist');
        } else {
          console.error('Error deleting file:', err);
        }
      } else {
        console.log('File deleted successfully');
      }
    });
  } catch (unlinkErr) {
    console.error('Error occurred while attempting to delete file:', unlinkErr);
  }
};


module.exports = function () {

  this.on('UPDATE', Files, async (req, res) => {
    const url = req.__dirname;

  })

  // this.on('READ', Files, async (req, res) => {
  //   const app = express();
  //   const port = 3000; // Choose any port number you prefer 
  //   // Set up the static file serving middleware 
  //   app.use(express.static('./srv/images')); // Assuming your images are stored in a 'public' folder 
  //   // Route handler for serving the image 
  //   app.get('/image', (req, res) => {
  //     // Assuming the image file name is 'image.jpg' in the 'public' folder 
  //     const imagePath = __dirname + '/public/image.jpg';
  //     res.sendFile(imagePath);
  //   });

  //   // Start the server 
  //   app.listen(port, () => {
  //     console.log(`Server is listening on port ${port}`);
  //   });
  // });

  
  this.on('process_document', async (req) => {
    try {

      const { uuid } = req.data;
      const db = await cds.connect.to('db');
      const host = req.headers.origin;
      const { Files, DocumentChunk } = this.entities;
      const capllmplugin = await cds.connect.to("cap-llm-plugin");
      let textChunkEntries = [];
      const embeddingModelName = "text-embedding-ada-002";

      // Check if document exists
      const isDocumentPresent = await SELECT.from(Files).where({ ID: uuid });
      if (isDocumentPresent.length == 0) {
        throw new Error(`Document with uuid:  ${uuid} not yet persisted in database!`)
      }

      // Load pdf from HANA and create a temp pdf doc
      // const stream = await db.stream(SELECT('content').from(Files, uuid));
      // const stream = await (SELECT('content').from(Files, uuid));
      const imgContent = await db.run(SELECT('content').from(Files).where({ ID: uuid }));
      //  const stream = await db.stream(SELECT('content').from(Files).where({ ID: uuid }));
      const fileName = await (SELECT('fileName').from(Files).where({ ID: uuid }));
      const fileNameString = fileName[0].fileName;
      const tempDocLocation = __dirname + `/${fileName[0].fileName}`;
      console.log("***********************************************************************************************\n");
      console.log(`Received the request to process the document ${fileNameString} and store it into SAP HANA Cloud!\n`);
      
      //Convert to Base64 and send to API
       const stream = new PassThrough;
       const chunks = [];

      stream.on('data', chunk => {
        chunks.push(chunk)
      })

       imgContent[0].content.pipe(stream);

      // // Wait for the stream to finish
      await new Promise((resolve, reject) => {
        stream.on('end', () => {
          resolve();
        });
      });


      // Convert Image array to Base 64
      const base64data = Buffer.concat(chunks).toString('base64');

      //Construct URL
      var image_url = 'data:image/png;base64,'+ base64data ;

      //Use LLM GPT 4o to feed the document and generate a JSON out of it

      // const image_url_content = host + `/odata/v4/process-document/Files(` + uuid + `)/content`;
  //     const image_url_value = host + `/odata/v4/process-document/Files(` + uuid + `)/$value`;
  //    const image_url_value = 'https://fa93f79etrial-dev-create-so-from-chat-srv.cfapps.us10-001.hana.ondemand.com' + `/odata/v4/process-document/Files(` + uuid + `)/$value`
      //set the modeName you want
      const chatModelName = "gpt-4o";
      console.log(`Leveraing the following LLMs \n Chat Model:  gpt-4o`);
      //      const memoryContext = await storeRetrieveMessages(conversationId, messageId, message_time, user_id, user_query, Conversation, Message, chatModelName);

      //Obtain the model configs configured in package.json
      const chatModelConfig = cds.env.requires["gen-ai-hub"][chatModelName];
      console.log("Getting the Chat respose response from the CAP LLM Plugin!");

      let determinationPayload = [{
        "role": "system",
        //        "content" : `${systemPrompt}`
        "content": "You are are helpful assistant"
      }];

      const userQuestion = [
        {
          "role": "user",
          //          "content": "Please extract the information from the pdf document" + pdfDoc + "and convert into JSON Format",
          "content":
          [
            {
               "type" : "text",
               "text"  : "Please extract the information from the image and convert into JSON Format"
            },
            {
               "type": "image_url",
	                "image_url": {
                        "url": image_url//image_url_value //image_url_value //
                    }
            }
          ] 
        }
       
      ]

      determinationPayload.push(...userQuestion);
      let payload = {
        "messages": determinationPayload,
//        "max_tokens": 100, 
        "stream": false 
      };

      //Do an executeHttpRequest call to consume the api

      const httpResponse = await executeHttpRequest({ destinationName: 'GENERATIVE_AI_HUB' },
        {
          url: '/v2/inference/deployments/d03c85df13ec9a7a/chat/completions?api-version=2023-05-15',
          method: 'post',
          data: payload,
          headers: { 'AI-Resource-Group': 'default' }
        },
        { fetchCsrfToken: false }

      );


//      let result = await capllmplugin.getChatCompletionWithConfig(chatModelConfig, payload);
      const resultJson = httpResponse.data.choices[0].message.content;

      determinationPayload = [];
      let system_assistant = [{
        "role": "system",
        //        "content" : `${systemPrompt}`
        "content": "You are are helpful assistant"
      }];

      const userQuestion_convertJson = [
        {
          "role": "user",
          //          "content": "Please extract the information from the pdf document" + pdfDoc + "and convert into JSON Format",
          "content":
          [
            {
               "type" : "text",
               "text"  : "Please convert this JSON  `${resultJson}` to meaningful JSON format"
            }
          ] 
        }
       
      ]
      
      determinationPayload.push(...userQuestion_convertJson);
      let payload_json = {
        "messages": determinationPayload,
//        "max_tokens": 100, 
        "stream": false 
      };
      
      const httpResponseJson = await executeHttpRequest({ destinationName: 'GENERATIVE_AI_HUB' },
        {
          url: '/v2/inference/deployments/d03c85df13ec9a7a/chat/completions?api-version=2023-05-15',
          method: 'post',
          data: payload_json,
          headers: { 'AI-Resource-Group': 'default' }
        },
        { fetchCsrfToken: false }

      );

      //Push this resulting JSON content to HANA DB entry in file table field JSONCONTENT

      // const updateStatus = await UPDATE(Files).set({ jsonContent: resultJson }).where({ ID: uuid });;
      // if (!updateStatus) {
      //   throw new Error("Updating of JSONContent into Table failed!");
      // }
      console.log(`Updating JSON Content for the document ${fileNameString} completed!\n`);

      //build the response payload for the frontend.
      const response = {
        "role": result.role,
        "content": result.content,
        "messageTime": responseTimestamp,
        "additionalContents": result.additionalContents,
      };

      return response;
//      deleteIfExists(tempDocLocation);

    }
    catch (error) {
      // Handle any errors that occur during the execution
      console.log('Error while Processing Image', error.message);
      throw error;
    }
    return "Embeddings stored successfully!";

  })


  // this.on('deleteEmbeddings', async () => {
  //   try {
  //     // Delete any previous records in the table
  //     const { DocumentChunk } = this.entities;
  //     await DELETE.from(DocumentChunk);
  //     return "Success!"
  //   }
  //   catch (error) {
  //     // Handle any errors that occur during the execution
  //     console.log('Error while deleting the embeddings content in db:', error);
  //     throw error;
  //   }
  // })


}