# Profit $ilo
### let data = profit;

This project is an API for collecting, storing and selling data for BSV micropayments, 
with a focus on automated machine to machine interactions.

## Project Background

This project was created in response to the Bitcoin Association BSV Hackathon 2020. One of the
stated objectives in the hackathon theme was to 'break down historic industry data silos'.
A data silo is a business unit of an organization that operates in isolation from other units. 
This generally creates a trade off between effective silos and the wider benefit of collaboration (Satell,2017).

In their paper titled 'Abandoning Silos', Mowat Research (2018) identified key barriers to horizontal collaboration. 
Notably, the uneven distribution of costs, data privacy concerns, the lack of a technical solution, and the 
uncertainty of how to do it effectively (Urban, 2018, pp7-9).

This project attempts to address all of those problems. This system stores data as named, ordered lists of signed messages 
which require payment to access. The design may seem similar to the concept of event sourcing, 
but is not designed for tracking every internal state change. It is about: 

- Asynchronous notifications for other systems 
- Allowing the data silo to do what it does best without interference
- Publishing data and documents tailored to the recipients
- Committing to a hash, being able to prove the existence of data at a point in time
- Creating mutual benefit by connecting silos (Satell, 2017)

## System Architecture

This system stores data in a PostgreSQL database. 
The API is a NodeJS app which accepts signed json messages over HTTP (multipart/form-data).
The command line wallet included is also written in NodeJS and uses an SQLite3 database file.

In this diagram there are 2 silos connected to one profit silo instance.
Other configurations could involve many-to-many depending on the context, 
ie the users and who is running the infrastructure.

![](./sysarch.jpg)

## System Requirements

- NodeJS v12.9.0
- PostgreSQL 12.3

## Server

### Quick Start
### Configuration
### 402 Payment Flow

## CLI Wallet

## Use Cases

## Prior Work

## Road Map

## References

Greg Satell, Breaking Down Silos Is a Myth, Do This Instead, 2017  
    https://www.inc.com/greg-satell/breaking-down-silos-is-a-myth-do-this-instead.html

MICHAEL CRAWFORD URBAN, Abandoning Silos, Mowat Research, 2018  
    https://munkschool.utoronto.ca/mowatcentre/wp-content/uploads/publications/178_abandoning_silos.pdf