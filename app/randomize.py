#!/usr/bin/python

# -*- coding: utf-8 -*-
"""
Yelp API v2.0 code sample.
This program demonstrates the capability of the Yelp API version 2.0
by using the Search API to query for businesses by a search term and location,
and the Business API to query additional information about the top result
from the search query.
Please refer to http://www.yelp.com/developers/documentation for the API documentation.
This program requires the Python oauth2 library, which you can install via:
`pip install -r requirements.txt`.
Sample usage of the program:
`python sample.py --term="bars" --location="San Francisco, CA"`
"""
import argparse
import json
import pprint
import sys
import urllib
import urllib2
import random
import oauth2
import math


API_HOST = 'api.yelp.com'
DEFAULT_TERM = 'lunch'
DEFAULT_LOCATION = '28 W 23rd St, New York, NY 10010'
SEARCH_LIMIT = 20
SEARCH_PATH = '/v2/search/'
BUSINESS_PATH = '/v2/business/'

# OAuth credential placeholders that must be filled in by users.
CONSUMER_KEY = 'UhDusQxgh6D_VeKkj8D98w'
CONSUMER_SECRET = 'sHM-788UbGvKCAYoUPFaMbnzEZA'
TOKEN = 'bTcmFIzr6_ReTS1imHsz83cBStzLIyVR'
TOKEN_SECRET = 'iRWWeUtfnxBwiOOuIlQnFEClReI'


def request(host, path, url_params=None):
    """Prepares OAuth authentication and sends the request to the API.
    Args:
        host (str): The domain host of the API.
        path (str): The path of the API after the domain.
        url_params (dict): An optional set of query parameters in the request.
    Returns:
        dict: The JSON response from the request.
    Raises:
        urllib2.HTTPError: An error occurs from the HTTP request.
    """
    url_params = url_params or {}
    url = 'http://{0}{1}?'.format(host, urllib.quote(path.encode('utf8')))

    consumer = oauth2.Consumer(CONSUMER_KEY, CONSUMER_SECRET)
    oauth_request = oauth2.Request(method="GET", url=url, parameters=url_params)

    oauth_request.update(
        {
            'oauth_nonce': oauth2.generate_nonce(),
            'oauth_timestamp': oauth2.generate_timestamp(),
            'oauth_token': TOKEN,
            'oauth_consumer_key': CONSUMER_KEY
        }
    )
    token = oauth2.Token(TOKEN, TOKEN_SECRET)
    oauth_request.sign_request(oauth2.SignatureMethod_HMAC_SHA1(), consumer, token)
    signed_url = oauth_request.to_url()
    
    conn = urllib2.urlopen(signed_url, None)
    try:
        response = json.loads(conn.read())
    finally:
        conn.close()

    return response

def search(term, location):
    """Query the Search API by a search term and location.
    Args:
        term (str): The search term passed to the API.
        location (str): The search location passed to the API.
    Returns:
        dict: The JSON response from the request.
    """
    
    url_params = {
        'term': term.replace(' ', '+'),
        'location': location.replace(' ', '+'),
        'limit': SEARCH_LIMIT,
        'radius_filter': 800
    }
    return request(API_HOST, SEARCH_PATH, url_params=url_params)

def get_business(business_id):
    """Query the Business API by a business ID.
    Args:
        business_id (str): The ID of the business to query.
    Returns:
        dict: The JSON response from the request.
    """
    business_path = BUSINESS_PATH + business_id

    return request(API_HOST, business_path)

def query_api(term, location, listall, describe):
    """Queries the API by the input values from the user.
    Args:
        term (str): The search term to query.
        location (str): The location of the business to query.
    """

    if describe is not 'not_a_restaurant':
        try:
            businesses = search(describe, location).get('businesses')
            bus = businesses[0]
            ret_bus = {'name': bus['name'], 'url': bus['url']}
            print json.dumps(ret_bus)
        except IndexError:
            print json.dumps({})
        return


    response = search(term, location)
    businesses = response.get('businesses')

    if not businesses:
        print u'No businesses for {0} in {1} found.'.format(term, location)
        return
        
    '''
    for key in businesses[0].keys():
        print key
        print businesses[0][key]
        print '-------------------------'
    '''


    if listall:
        bus_list = []
        for bus in businesses:
            try:
                bus_list.append({'name': bus['name'], 'location': bus['location']['cross_streets'], 'distance': "{:.2f}".format((bus['distance'] * .00062)), 'url': bus['url']})
            except KeyError:
                bus_list.append({'name': bus['name'], 'location': bus['location']['display_address'], 'distance': "{:.2f}".format((bus['distance'] * .00062)), 'url': bus['url']})

        print json.dumps(bus_list)
        return

    n_bus= len(businesses)
    bus = businesses[int(math.floor((n_bus - 1) * random.random()))]
    try:
        ret_bus = {'name': bus['name'], 'location': bus['location']['cross_streets'], 'distance': "{:.2f}".format((bus['distance'] * .00062)), 'url': bus['url']}
    except KeyError:
        ret_bus = {'name': bus['name'], 'location': bus['location']['display_address'], 'distance': "{:.2f}".format((bus['distance'] * .00062)), 'url': bus['url']}

    print json.dumps(ret_bus)
    

def main():
    parser = argparse.ArgumentParser()

    parser.add_argument('-q', '--term', dest='term', default=DEFAULT_TERM, type=str, help='Search term (default: %(default)s)')

    parser.add_argument('-l', '--list-all', dest='listall', default=False, type=bool, help='no help')

    parser.add_argument('-d', '--describe', dest='describe', default="not_a_restaurant", type=str, help='no help')

    input_values = parser.parse_args()

    try:
        query_api(input_values.term, DEFAULT_LOCATION, input_values.listall, input_values.describe)
    except urllib2.HTTPError as error:
        sys.exit('Encountered HTTP error {0}. Abort program.'.format(error.code))


if __name__ == '__main__':
    main()